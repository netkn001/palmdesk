import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { pageTimelineItems } from "../core/session-registry.mjs";
import {
  createWorkBuddySessionFileCatalog,
  getRawWorkBuddySessionFile,
  getWorkBuddySessionFileSession,
  getWorkBuddySessionFileTimelinePage,
  isWorkBuddySessionFileSessionId,
  resolveWorkBuddyHome
} from "./workbuddy-session-file.mjs";

export function createWorkBuddyProvider(options = {}) {
  const workbuddyHome = options.workbuddyHome ?? resolveWorkBuddyHome();
  const sessionFiles =
    options.sessionFileCatalog ??
    createWorkBuddySessionFileCatalog({
      workbuddyHome,
      summaryOnly: true
    });

  async function listActiveSessionMetas() {
    const sessionsDir = path.join(workbuddyHome, "sessions");
    try {
      const files = await readdir(sessionsDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const metas = [];
      const now = Date.now();
      for (const file of jsonFiles) {
        try {
          const content = await readFile(path.join(sessionsDir, file), "utf8");
          const data = JSON.parse(content);
          // If heartbeat or updatedAt was within 5 minutes, consider it active
          const lastActive = data.lastHeartbeat || data.updatedAt || data.startedAt;
          if (lastActive && now - lastActive < 5 * 60 * 1000) {
            metas.push(data);
          }
        } catch {
          // ignore corrupted single session files
        }
      }
      return metas;
    } catch {
      return [];
    }
  }

  return {
    id: "workbuddy",
    displayName: "WorkBuddy",

    async listSessions() {
      const [sessionFileSessions, activeMetas] = await Promise.all([
        sessionFiles.listSessions(),
        listActiveSessionMetas()
      ]);

      const activeCwds = new Set(activeMetas.map((m) => m.cwd).filter(Boolean));

      return sessionFileSessions.map((session) => {
        const isActive =
          activeCwds.has(session.projectPath) ||
          (activeMetas.length > 0 &&
            Date.now() - new Date(session.lastUpdatedAt).getTime() < 30 * 60 * 1000);

        return {
          ...session,
          status: isActive ? "running" : "idle"
        };
      });
    },

    async getSession(id) {
      if (isWorkBuddySessionFileSessionId(id)) {
        const location = await sessionFiles.resolve(id);
        if (!location) return null;

        const session = await getWorkBuddySessionFileSession(id, {
          workbuddyHome,
          sessionFilePath: location.filePath
        });
        if (!session) return null;

        const activeMetas = await listActiveSessionMetas();
        const activeCwds = new Set(activeMetas.map((m) => m.cwd).filter(Boolean));
        const isActive =
          activeCwds.has(session.projectPath) ||
          (activeMetas.length > 0 &&
            Date.now() - new Date(session.lastUpdatedAt).getTime() < 30 * 60 * 1000);

        return {
          ...session,
          status: isActive ? "running" : "idle"
        };
      }

      const sessions = await this.listSessions();
      return sessions.find((session) => session.id === id) ?? null;
    },

    async getSessionTimelinePage(id, options = {}) {
      if (isWorkBuddySessionFileSessionId(id)) {
        const location = await sessionFiles.resolve(id);
        if (!location) return null;

        return getWorkBuddySessionFileTimelinePage(id, {
          ...options,
          workbuddyHome,
          sessionFilePath: location.filePath
        });
      }

      const session = await this.getSession(id);
      return session ? pageTimelineItems(session.timeline, options) : null;
    },

    async getRawSession(id) {
      const location = isWorkBuddySessionFileSessionId(id) ? await sessionFiles.resolve(id) : null;
      return getRawWorkBuddySessionFile(id, {
        workbuddyHome,
        ...(isWorkBuddySessionFileSessionId(id)
          ? { sessionFilePath: location?.filePath ?? null }
          : {})
      });
    }
  };
}
