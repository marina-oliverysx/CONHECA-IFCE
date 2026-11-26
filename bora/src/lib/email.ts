export async function sendLoginEmail(to: string, token: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY,
       from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY or AUTH_EMAIL_FROM configuration");

  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Seu código de acesso",
      text: `Use este token de acesso único no aplicativo. Ele expira em 10 minutos:\n\n${token}\n\nSe você não solicitou este acesso, ignore esta mensagem.`,
    }),
  });
  if (!result.ok) throw new Error(`Email provider returned HTTP ${result.status}`);
}
