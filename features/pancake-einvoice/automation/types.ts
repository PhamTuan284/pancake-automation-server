import { remote } from 'webdriverio';

export type WdioBrowser = Awaited<ReturnType<typeof remote>>;
export type WdioElement = Awaited<ReturnType<WdioBrowser['$']>>;
