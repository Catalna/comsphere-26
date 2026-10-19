import { HttpError } from "./errors.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createSessionToken, hashSessionToken } from "./sessionTokens.js";
import { parseLogin, parseRegistration } from "./validation.js";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = hashPassword("dana-terang-dummy-password-value");

function clientUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organization: user.organization ?? null,
  };
}

export function createAuthService({ authRepository, now = () => new Date() }) {
  if (!authRepository) throw new TypeError("An auth repository is required");

  return Object.freeze({
    async register(input) {
      const data = parseRegistration(input);
      if (!data) throw new HttpError(400, "invalid_request");

      const passwordHash = await hashPassword(data.password);
      const { token, tokenHash } = createSessionToken();
      const currentTime = now();
      let account;
      try {
        account = await authRepository.registerOrganizer({
          ...data,
          passwordHash,
          sessionTokenHash: tokenHash,
          sessionExpiresAt: new Date(currentTime.getTime() + SESSION_LIFETIME_MS),
          now: currentTime,
        });
      } catch (error) {
        if (error?.code === "23505") throw new HttpError(409, "account_unavailable");
        throw error;
      }
      return { user: clientUser(account.user), token };
    },

    async login(input) {
      const data = parseLogin(input);
      if (!data) throw new HttpError(400, "invalid_request");

      const user = await authRepository.findUserByEmail(data.email);
      const encodedHash = user?.passwordHash ?? await DUMMY_PASSWORD_HASH;
      const passwordMatches = await verifyPassword(data.password, encodedHash);
      if (!user || user.status !== "ACTIVE" || !passwordMatches) {
        throw new HttpError(401, "invalid_credentials");
      }

      const { token, tokenHash } = createSessionToken();
      const currentTime = now();
      await authRepository.createSession({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(currentTime.getTime() + SESSION_LIFETIME_MS),
        now: currentTime,
      });
      return { user: clientUser(user), token };
    },

    async loadSessionUser(token) {
      if (typeof token !== "string") return null;
      let tokenHash;
      try {
        tokenHash = hashSessionToken(token);
      } catch {
        return null;
      }
      return authRepository.findSessionUser(tokenHash, now());
    },

    async logout(token) {
      if (typeof token !== "string") return 0;
      try {
        return await authRepository.revokeSession(hashSessionToken(token), now());
      } catch {
        return 0;
      }
    },
  });
}
