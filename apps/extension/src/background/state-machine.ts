// apps/extension/src/background/state-machine.ts
// Capdio Deterministic Recording Finite-State Machine (MASTER_SPEC.md §02.4)

import { MessageBusError } from '../shared/message-bus.ts';
import type { RecordStatus, ErrorCode } from '../shared/types.ts';

export type StateChangeListener = (
  newStatus: RecordStatus,
  prevStatus: RecordStatus,
  reason?: string
) => void;

/**
 * Valid state transitions mapping (TDR §2.4):
 * IDLE → REQUESTING_PERMISSION → PREPARING → RECORDING ↔ PAUSED → FINALIZING → READY
 * Failure paths: ERROR or INTERRUPTED
 */
const VALID_TRANSITIONS: Record<RecordStatus, readonly RecordStatus[]> = {
  idle: ['requesting_permission', 'preparing', 'error'],
  requesting_permission: ['preparing', 'idle', 'error'],
  preparing: ['recording', 'finalizing', 'idle', 'error'],
  recording: ['paused', 'finalizing', 'interrupted', 'error'],
  paused: ['recording', 'finalizing', 'interrupted', 'error'],
  finalizing: ['ready', 'error'],
  ready: ['idle'],
  interrupted: ['idle'],
  error: ['idle']
};

export class RecordingStateMachine {
  private _status: RecordStatus = 'idle';
  private _activeSessionId: string | null = null;
  private _listeners: Set<StateChangeListener> = new Set();
  private _lastError: { code: ErrorCode; message: string } | null = null;

  public get currentStatus(): RecordStatus {
    return this._status;
  }

  public get activeSessionId(): string | null {
    return this._activeSessionId;
  }

  public get lastError(): { code: ErrorCode; message: string } | null {
    return this._lastError;
  }

  public isRecording(): boolean {
    return this._status === 'recording';
  }

  public isPaused(): boolean {
    return this._status === 'paused';
  }

  public isIdle(): boolean {
    return this._status === 'idle';
  }

  public isActive(): boolean {
    return (
      this._status === 'requesting_permission' ||
      this._status === 'preparing' ||
      this._status === 'recording' ||
      this._status === 'paused' ||
      this._status === 'finalizing'
    );
  }

  /**
   * Subscribes to status changes. Returns an unsubscribe callback.
   */
  public onStateChange(listener: StateChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Sets the active session ID associated with this recording lifecycle.
   */
  public setSessionId(sessionId: string | null): void {
    this._activeSessionId = sessionId;
  }

  /**
   * Transitions the FSM to a new target state, validating against permitted transitions.
   */
  public transitionTo(
    nextStatus: RecordStatus,
    reason?: string,
    errorInfo?: { code: ErrorCode; message: string }
  ): RecordStatus {
    const prevStatus = this._status;

    // Idempotency: Transitioning to the exact same state is a safe no-op
    if (prevStatus === nextStatus) {
      return this._status;
    }

    // Idempotency for Stop: Calling stop/finalizing when already idle or ready is safe
    if (
      nextStatus === 'finalizing' &&
      (prevStatus === 'idle' || prevStatus === 'ready' || prevStatus === 'error')
    ) {
      return this._status;
    }

    const allowed = VALID_TRANSITIONS[prevStatus];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw new MessageBusError(
        'E_SESSION_CONFLICT',
        `Invalid state transition: Cannot transition from '${prevStatus}' to '${nextStatus}'`
      );
    }

    this._status = nextStatus;

    if (errorInfo) {
      this._lastError = errorInfo;
    } else if (nextStatus === 'idle' || nextStatus === 'ready') {
      this._lastError = null;
    }

    if (nextStatus === 'idle') {
      this._activeSessionId = null;
    }

    // Notify registered listeners
    for (const listener of this._listeners) {
      try {
        listener(nextStatus, prevStatus, reason);
      } catch (err) {
        console.error('[RecordingStateMachine] Error in state change listener:', err);
      }
    }

    return this._status;
  }

  /**
   * Helper: Request start of a capture session.
   */
  public requestStart(sessionId: string): void {
    if (this.isActive()) {
      throw new MessageBusError(
        'E_SESSION_CONFLICT',
        `Cannot start capture: Session '${this._activeSessionId}' is already in state '${this._status}'`
      );
    }
    this.setSessionId(sessionId);
    this.transitionTo('requesting_permission', 'User initiated recording');
  }

  /**
   * Helper: Permission granted, preparing stream & encoder.
   */
  public markPreparing(): void {
    this.transitionTo('preparing', 'Permission granted, preparing capture');
  }

  /**
   * Helper: Recording actively started.
   */
  public markRecording(): void {
    this.transitionTo('recording', 'Encoder started');
  }

  /**
   * Helper: Pause active recording.
   */
  public pause(): void {
    this.transitionTo('paused', 'User requested pause');
  }

  /**
   * Helper: Resume paused recording.
   */
  public resume(): void {
    this.transitionTo('recording', 'User requested resume');
  }

  /**
   * Helper: Stop active or paused recording.
   */
  public stop(): void {
    this.transitionTo('finalizing', 'User requested stop');
  }

  /**
   * Helper: Finalization complete, media ready.
   */
  public markReady(): void {
    this.transitionTo('ready', 'Finalization complete');
  }

  /**
   * Helper: Source tab closed or capture interrupted.
   */
  public markInterrupted(reason = 'Source closed or disconnected'): void {
    this.transitionTo('interrupted', reason);
  }

  /**
   * Helper: Mark error state.
   */
  public markError(code: ErrorCode, message: string): void {
    this.transitionTo('error', message, { code, message });
  }

  /**
   * Helper: Reset state back to IDLE.
   * If keepLastError is true, preserves the error code/message so UI can report what happened.
   */
  public reset(keepLastError = false): void {
    const prevErr = this._lastError;
    this.transitionTo('idle', 'FSM reset to idle');
    if (keepLastError) {
      this._lastError = prevErr;
    }
  }
}
