import { db } from "./db";

export type NotifyInput = {
  type: string;
  title: string;
  body: string;
  link?: string | null;
};

/** Notify one user. */
export async function notifyUser(userId: string, input: NotifyInput) {
  await db.notification.create({
    data: { userId, type: input.type, title: input.title, body: input.body, link: input.link ?? null },
  });
}

/** Notify every user holding a role (optionally scoped to a region). */
export async function notifyRole(role: string, input: NotifyInput, regionId?: string | null) {
  const users = await db.user.findMany({
    where: { role, ...(regionId ? { regionId } : {}) },
    select: { id: true },
  });
  if (!users.length) return;
  await db.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })),
  });
}

/** Notify every user belonging to an institution. */
export async function notifyInstitution(institutionId: string, input: NotifyInput) {
  const users = await db.user.findMany({ where: { institutionId }, select: { id: true } });
  if (!users.length) return;
  await db.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })),
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, read: false } });
}
