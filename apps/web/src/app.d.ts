// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    interface PageState {
      /** The cards opened one from another since the page, for the back button and the close. */
      cards?: number;
    }
    // interface Platform {}
  }
}

export {};
