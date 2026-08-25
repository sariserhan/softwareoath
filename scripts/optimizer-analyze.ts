import { gzipSync } from "node:zlib";

import { analyzeRepositoryStatic } from "../src/optimizer/analyze.js";

const analysis = await analyzeRepositoryStatic({ repositoryPath: process.cwd() });
const compressed = gzipSync(JSON.stringify(analysis)).toString("base64");
process.stdout.write("SOFTWARE_OATH_ANALYSIS_GZIP_V1:" + compressed + "\n");
