import { createRollingMultiplayerStore } from './rolling-multiplayer-store.js';
import { createGameServiceIdentity } from './service-identity.js';

/** Deployment composition only. Dedicated service settings must be provisioned;
 * no operator, Foxxi or human account credential is inherited as a fallback.
 * @interego/core and @interego/pgsl must be pinned build artifacts from Interego.
 */
export async function configuredGamingStore(env = process.env, modules) {
  if (env.HM_GAMING_ENABLED !== '1') return null;
  const keys = ['POD_URL', 'OWNER', 'PRIVATE_KEY', 'OWNER_PUBLIC_KEY'];
  const settings = Object.fromEntries(keys.map(k => [k, env['HM_GAMING_NATIVE_' + k]]));
  if (Object.values(settings).some(x => typeof x !== 'string' || !x)) throw new Error('Gaming requires a dedicated native service identity and stable keys.');
  if (!/^(0x)?[a-f0-9]{64}$/i.test(settings.PRIVATE_KEY)) throw new Error('Gaming encryption key is invalid.');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(settings.OWNER_PUBLIC_KEY)) throw new Error('Gaming owner encryption public key is invalid.');
  const pod = new URL(settings.POD_URL);
  if (pod.protocol !== 'https:' || !pod.pathname.endsWith('/') || pod.search || pod.hash || pod.username || pod.password) throw new Error('Gaming requires a private HTTPS service pod.');
  const serviceIdentity = env.HM_GAMING_SERVICE_IDENTITY_KEY_JSON ? createGameServiceIdentity({
    identityOrigin: env.HM_GAMING_SERVICE_IDENTITY_ORIGIN || 'https://identity.interego.xwisee.com',
    keyJwk: env.HM_GAMING_SERVICE_IDENTITY_KEY_JSON, expectedPodUrl: pod.href,
    fetch: modules?.identityFetch || globalThis.fetch,
  }) : null;
  if (serviceIdentity && serviceIdentity.owner !== settings.OWNER) throw new Error('Gaming native owner must match its dedicated service identity.');
  if (!serviceIdentity && !env.HM_GAMING_NATIVE_CAPABILITY) throw new Error('Gaming requires a dedicated service credential.');
  // The two-step identity ceremony has its own bounded deadline. Prime it before
  // native HTTP requests start their shorter per-resource transport deadline.
  if (serviceIdentity) await serviceIdentity.credentials();
  const native = modules?.native || await import('@interego/pgsl');
  const core = modules?.core || await import('@interego/core');
  const senderKeyPair = core.deriveEncryptionKeyPair(settings.PRIVATE_KEY, settings.OWNER);
  const store = createRollingMultiplayerStore({ native, namespace: 'hallowmarch-shared-expedition-v1',
    scope: { pod: pod.href, owner: settings.OWNER, headUrl: env.HM_GAMING_NATIVE_HEAD_URL || new URL('gaming/head', pod).href,
      artifactContainer: env.HM_GAMING_NATIVE_ARTIFACT_CONTAINER || new URL('gaming/artifacts/', pod).href },
    senderKeyPair, ownerPublicKey: settings.OWNER_PUBLIC_KEY, recipientPublicKeys: [...new Set([settings.OWNER_PUBLIC_KEY, senderKeyPair.publicKey])],
    credentialsProvider: serviceIdentity ? () => serviceIdentity.credentials() : async () => ({ Authorization: `Bearer ${env.HM_GAMING_NATIVE_CAPABILITY}` }) });
  if (serviceIdentity) Object.defineProperty(store, 'publicationIdentity', { value: async () => {
    const metadata = await serviceIdentity.metadata();
    return { owner: metadata.owner, ownerWebId: metadata.ownerWebId, agentDid: metadata.agentDid, userId: metadata.userId, podUrl: metadata.podUrl, podAliases: metadata.podAliases,
      credentialsProvider: () => serviceIdentity.credentials(), graphDigest: core.canonicalGraphDigest };
  } });
  return store;
}
