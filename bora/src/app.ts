import express, { Request, Response } from "express";
import { prisma } from "./lib/prisma.js";
import { createHash, randomBytes } from "node:crypto";
import { sendLoginEmail } from "./lib/email.js";
import { requireAuth, requireRole, AuthenticatedRequest } from "./middleware/auth.js";

const app = express();
app.use(express.json());

const TOKEN_MINUTES = 10,
      SESSION_DAYS = 7, GENERIC_ACCESS_MESSAGE = "Se o e-mail estiver cadastrado, você receberá as instruções para acessar.",
      accessAttempts = new Map<string, { count: number; resetAt: number }>(),
      hashToken = (token: string) => createHash("sha256").update(token).digest("hex"),
      normalizeEmail = (email: string) => email.trim().toLowerCase(),
      validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function limitAccessRequests(request: Request, response: Response, next: () => void) {
  const key = request.ip ?? "unknown",
        now = Date.now(),
        current = accessAttempts.get(key);
  if (!current || current.resetAt <= now) {
    accessAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return next();
  }

  if (current.count >= 5) {
    return response.status(429).json({ error: "MUITAS TENTATIVAS. AGUARDE ALGUNS MINUTOS." });
  }
  current.count += 1;
  return next();
}

async function issueLoginToken(userId: number, email: string) {
  const rawToken = randomBytes(32).toString("base64url"),
        tokenHash = hashToken(rawToken),
        expiresAt = new Date(Date.now() + TOKEN_MINUTES * 60_000);

  await prisma.emailLoginToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.emailLoginToken.create({ data: { userId, tokenHash, expiresAt } });
  try {
    await sendLoginEmail(email, rawToken);
  } catch (error) {
    await prisma.emailLoginToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: new Date() } });
    throw error;
  }
}

app.post("/auth/register", limitAccessRequests, async (request: Request, response: Response) => {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return response.status(400).json({ error: "Envie um objeto JSON com nome e e-mail." });
  }

  const { name, email } = body;
  if (typeof name !== "string" || typeof email !== "string") {
    return response.status(400).json({ error: "Nome e e-mail devem ser textos." });
  }

  const cleanName = name.trim(),
        cleanEmail = normalizeEmail(email);
  if (!cleanName || !validEmail(cleanEmail)) {
    return response.status(400).json({ error: "Informe um nome e um e-mail válido." });
  }

  try {
    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user) {
      user = await prisma.user.create({ data: { name: cleanName, email: cleanEmail, role: "VISITOR" } });
    }
    await issueLoginToken(user.id, user.email);
    return response.status(202).json({ message: GENERIC_ACCESS_MESSAGE });
  }
  catch (error){
    console.error("Could not register/request access", error);
    return response.status(202).json({ message: GENERIC_ACCESS_MESSAGE});
  }
});

app.post("/auth/request-access", limitAccessRequests, async (request: Request, response: Response) => {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.email !== "string") {
    return response.status(400).json({ error: "Envie um e-mail válido." });
  }
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return response.status(400).json({ error: "INFORME UM E-MAIL VÁLIDO." });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await issueLoginToken(user.id, user.email);
    return response.status(202).json({ message: GENERIC_ACCESS_MESSAGE });
  }
  catch (error) {
    console.error("Could not request access", error);
    return response.status(202).json({ message: GENERIC_ACCESS_MESSAGE });
  }
});

app.post("/auth/confirm", async (request: Request, response: Response) => {

  const token = request.body?.token;
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return response.status(400).json({ error: "TOKEN INVÁLIDO OU EXPIRADO." });
  }

  const now = new Date(),
        tokenHash = hashToken(token),
        sessionToken = randomBytes(32).toString("base64url"),
        sessionHash = hashToken(sessionToken),
        sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000);

  try {
    const session = await prisma.$transaction(async (tx) => {
      const loginToken = await tx.emailLoginToken.findUnique({ where: { tokenHash } });
      if (!loginToken || loginToken.usedAt || loginToken.expiresAt <= now) return null;
      const claimed = await tx.emailLoginToken.updateMany({
        where: { id: loginToken.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      return tx.userSession.create({ data: { tokenHash: sessionHash, userId: loginToken.userId, expiresAt: sessionExpiresAt } });
    });
    if (!session) return response.status(401).json({ error: "TOKEN INVÁLIDO, EXPIRADO OU JÁ UTILIZADO." });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
    return response.status(200).json({ message: "Acesso confirmado." });
  }
  catch (error) {
    console.error("Could not confirm access", error);
    return response.status(500).json({ error: "Não foi possível confirmar o acesso." });
  }
});

app.post("/auth/logout", requireAuth, async (request: AuthenticatedRequest, response: Response) => {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("session=")),
        rawToken = cookie?.slice("session=".length);

  if (rawToken) await prisma.userSession.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  response.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  return response.status(200).json({ message: "Sessão encerrada." });
});

app.get("/auth/me", requireAuth, (request: AuthenticatedRequest, response: Response) => {
  return response.json({ user: request.user });
});

app.patch("/admin/users/:id/role", requireAuth, requireRole("ADMIN"), async (request: AuthenticatedRequest, response: Response) => {
  const userId = Number(request.params.id);
  if (!Number.isSafeInteger(userId) || userId < 1 || request.body?.role !== "MEMBER") {
    return response.status(400).json({ error: "Informe um usuário válido e role MEMBER." });
  }
  try {
    const updated = await prisma.user.updateMany({ where: { id: userId, role: "VISITOR" }, data: { role: "MEMBER" } });
    if (updated.count !== 1) return response.status(404).json({ error: "Visitante não encontrado." });
    return response.json({ message: "Usuário promovido a MEMBER." });
  }
  catch (error) {
    console.error("Could not promote user", error);
    return response.status(500).json({ error: "Não foi possível promover o usuário." });
  }
});

app.get("/task", requireAuth, (request: AuthenticatedRequest, response: Response) => {
  return response.status(200).json({ tasks: [{ id: 1, name: "fazer algo", done: false }], user: request.user });
});

export default app;