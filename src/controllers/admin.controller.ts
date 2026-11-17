import { Request, Response } from "express";

export function getMe(req: Request, res: Response) {
  const user = req.user!;
  res.json({
    uid: user.uid,
    email: user.email ?? null,
    name: user.name ?? null,
    admin: user.admin === true,
    authTime: user.auth_time,
  });
}
