// apps/extension/src/shared/message-bus.ts
// Strongly-typed runtime message bus with sender boundary enforcement and schema guards

import type {
  ExtensionMessage,
  MessageResponse,
  ErrorCode,
  MessageTarget
} from './types';

export class MessageBusError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'MessageBusError';
    this.code = code;
  }
}

/**
 * Validates whether an incoming message matches the minimal BaseMessage schema.
 */
export function isValidMessageSchema(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return (
    typeof msg.id === 'string' &&
    typeof msg.target === 'string' &&
    typeof msg.action === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

/**
 * Validates that an incoming sender matches the current extension's runtime ID.
 */
export function isAuthorizedSender(sender: chrome.runtime.MessageSender): boolean {
  return !!sender && sender.id === chrome.runtime.id;
}

/**
 * Helper to construct an RFC4122 v4 UUID or fallback token.
 */
export function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Sends a strongly-typed message across extension components (Popup -> Background -> Offscreen).
 */
export async function sendTypedMessage<TResponse = unknown>(
  target: MessageTarget,
  action: ExtensionMessage['action'],
  payload?: unknown
): Promise<MessageResponse<TResponse>> {
  const message: ExtensionMessage = {
    id: generateMessageId(),
    target,
    action: action as any,
    timestamp: Date.now(),
    ...(payload ? { payload } : {})
  } as ExtensionMessage;

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: MessageResponse<TResponse>) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          resolve({
            success: false,
            errorCode: 'E_BROWSER_INCOMPATIBLE',
            error: lastErr.message
          });
        } else if (!response) {
          resolve({
            success: false,
            errorCode: 'E_INVALID_MESSAGE',
            error: 'Empty response received from message handler'
          });
        } else {
          resolve(response);
        }
      });
    } catch (err: any) {
      resolve({
        success: false,
        errorCode: 'E_INVALID_MESSAGE',
        error: err.message || 'Failed to dispatch message'
      });
    }
  });
}

export type MessageHandler<T = any, R = any> = (
  message: T,
  sender: chrome.runtime.MessageSender
) => Promise<R> | R;

/**
 * Registers a typed listener for a specific target component ('background' | 'offscreen' | 'popup').
 */
export function registerMessageListener(
  targetComponent: MessageTarget,
  handlers: Record<string, MessageHandler>
): () => void {
  const listener = (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // 1. Enforce sender boundary
    if (!isAuthorizedSender(sender)) {
      console.warn(`[MessageBus] Unauthorized sender rejected:`, sender);
      sendResponse({
        success: false,
        errorCode: 'E_ACCESS_DENIED',
        error: 'Unauthorized sender origin'
      });
      return false;
    }

    // 2. Validate message schema
    if (!isValidMessageSchema(rawMessage)) {
      console.warn(`[MessageBus] Malformed message schema rejected:`, rawMessage);
      sendResponse({
        success: false,
        errorCode: 'E_INVALID_MESSAGE',
        error: 'Invalid message structure'
      });
      return false;
    }

    // 3. Check target component
    if (rawMessage.target !== targetComponent) {
      // Not intended for this component; let other listeners handle it
      return false;
    }

    // 4. Dispatch to action handler
    const handler = handlers[rawMessage.action];
    if (!handler) {
      console.warn(`[MessageBus] No handler registered for action: ${rawMessage.action}`);
      sendResponse({
        success: false,
        errorCode: 'E_INVALID_MESSAGE',
        error: `Unhandled action: ${rawMessage.action}`
      });
      return false;
    }

    // Execute handler asynchronously
    Promise.resolve()
      .then(() => handler(rawMessage, sender))
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        const errorCode: ErrorCode =
          err instanceof MessageBusError ? err.code : 'E_ENCODER_FAILED';
        sendResponse({
          success: false,
          errorCode,
          error: err.message || 'Handler execution failed'
        });
      });

    return true; // Keep message channel open for async response
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
