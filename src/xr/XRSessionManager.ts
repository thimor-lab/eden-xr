import * as THREE from 'three';

/**
 * Manages the WebXR immersive-vr session with optical hand-tracking on Android XR.
 */
export class XRSessionManager {
  private currentSession: XRSession | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly button: HTMLButtonElement,
    private readonly onSessionChange?: (inVR: boolean) => void
  ) {
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    // Higher framebuffer scale improves clarity on high-DPI Android XR headsets
    this.renderer.xr.setFramebufferScaleFactor(1.4);
    void this.initButton();
  }

  get inVR(): boolean {
    return this.currentSession !== null;
  }

  private async initButton(): Promise<void> {
    if (!navigator.xr) {
      this.button.textContent = 'WebXR Unavailable (Desktop Mode Active)';
      this.button.disabled = true;
      return;
    }

    const supported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    if (!supported) {
      this.button.textContent = 'Desktop Mode (Open on Android XR for VR)';
      this.button.disabled = true;
      return;
    }

    this.button.textContent = 'Enter VR (Android XR)';
    this.button.disabled = false;
    this.button.addEventListener('click', () => {
      if (this.currentSession) {
        void this.currentSession.end();
      } else {
        void this.startSession();
      }
    });
  }

  private async startSession(): Promise<void> {
    if (!navigator.xr) return;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['hand-tracking', 'local-floor', 'bounded-floor'],
      });
      this.currentSession = session;
      session.addEventListener('end', () => {
        this.currentSession = null;
        this.button.textContent = 'Enter VR (Android XR)';
        this.onSessionChange?.(false);
      });
      await this.renderer.xr.setSession(session);
      this.button.textContent = 'Exit VR';
      this.onSessionChange?.(true);
    } catch (err) {
      console.error('Failed to start WebXR session:', err);
      this.button.textContent = 'VR Start Failed (Check Permissions)';
    }
  }
}
