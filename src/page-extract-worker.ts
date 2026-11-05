/** Worker entry for page-extract.ts: parse the page, post back plain facts, exit. */
import { parentPort, workerData } from "node:worker_threads";

import { extractFacts } from "./page-extract.js";

parentPort?.postMessage(extractFacts(workerData as string));
