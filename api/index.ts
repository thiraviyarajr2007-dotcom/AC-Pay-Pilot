import { createAppServer } from '../server';

const appPromise = createAppServer();

export const maxDuration = 30;

export default async function handler(req: any, res: any) {
  const app = await appPromise;
  return app(req, res);
}
