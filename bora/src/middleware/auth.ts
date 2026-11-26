import { createHash } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export type AppRole = "ADMIN" | "MEMBER" | "VISITOR";
export type AuthenticatedRequest = Request & {
  user?: { id: number; name: string; email: string; role: AppRole };
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("session=")),
        token = cookie?.slice("session=".length);
  if (!token) return response.status(401).json({ error: "Autenticação necessária." });

  try {
    const session = await prisma.userSession.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
      select: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!session) return response.status(401).json({ error: "Sessão inválida ou expirada." });
    request.user = session.user as AuthenticatedRequest["user"];
    return next();
  } catch (error) {
    console.error("Could not authenticate request", error);
    return response.status(500).json({ error: "Não foi possível verificar a sessão." });
  }
}

export function requireRole(...roles: AppRole[]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return response.status(403).json({ error: "Você não tem permissão para esta operação." });
    }
    return next();
  };
}
