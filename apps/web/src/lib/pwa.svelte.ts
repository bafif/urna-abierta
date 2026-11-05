import { resolve } from '$app/paths';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Installing the app, and updating it only when the person agrees. */
class Pwa {
  installed = $state(standalone());
  /** iPhone gives the installed app its own empty storage, so it needs its own way in. */
  readonly iphone = /iP(hone|ad|od)/.test(navigator.userAgent);
  installEvent = $state<(Event & { prompt: () => Promise<void> }) | null>(null);
  waitingWorker = $state<ServiceWorker | null>(null);
  private updateAccepted = false;

  start(): void {
    addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installEvent = event as Event & { prompt: () => Promise<void> };
    });
    addEventListener('appinstalled', () => {
      this.installEvent = null;
    });
    if (!('serviceWorker' in navigator)) return;
    // Read before registering. On a first install the worker takes control within moments,
    // and that must not be mistaken for a new version waiting.
    const isUpdate = Boolean(navigator.serviceWorker.controller);
    void navigator.serviceWorker.register(`${resolve('/')}service-worker.js`).then((registration) => {
      if (!isUpdate) return;
      const watch = (worker: ServiceWorker | null) => {
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') this.waitingWorker = worker;
        });
      };
      if (registration.waiting) this.waitingWorker = registration.waiting;
      watch(registration.installing);
      registration.addEventListener('updatefound', () => watch(registration.installing));
    });
    // The app only ever reloads because the person accepted the update, in this very tab.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.updateAccepted) location.reload();
    });
  }

  update(): void {
    this.updateAccepted = true;
    this.waitingWorker?.postMessage('update-now');
  }

  async install(): Promise<void> {
    await this.installEvent?.prompt();
    this.installEvent = null;
  }
}

export const pwa = new Pwa();
