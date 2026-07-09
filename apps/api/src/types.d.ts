import type { KeyMode } from "@schemap/core";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        workspaceId: string;
        via: "session" | "api_key" | "embed";
        userId?: string;
        sessionId?: string;
        keyMode?: KeyMode;
        /** embed tokens are pinned to one schema */
        embedSchemaId?: string;
        endUserOrg?: string;
      };
    }
  }
}

export {};
