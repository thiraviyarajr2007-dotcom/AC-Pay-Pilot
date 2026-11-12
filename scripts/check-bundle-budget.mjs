import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

const BUDGETS = {
  entryJsRawBytes: 250 * 1024,
  entryJsGzipBytes: 75 * 1024,
  entryCssRawBytes: 200 * 1024,
  entryCssGzipBytes: 40 * 1024,
  appRouteChunkRawBytes: 150 * 1024,
  appRouteChunkGzipBytes: 45 * 1024,
  forbiddenIndexPreloads: [
    'SellerCommandCenterScreen',
    'DashboardScreen',
    'vendor-three',
    'vendor-recharts',
    'vendor-ag-grid',
    'vendor-ag-studio',
    'vendor-ag-charts',
  ],
  vendorBudgetsRawBytes: {
    'vendor-react': 350 * 1024,
    'vendor-firebase-core': 150 * 1024,
    'vendor-firebase-firestore': 550 * 1024,
    'vendor-recharts': 450 * 1024,
    'vendor-three': 650 * 1024,
  },
};

export function evaluateDistBundleBudgets() {
  if (!fs.existsSync(ASSETS_DIR)) {
    return {
      ok: false,
      violations: ['dist/assets directory does not exist; run npm run build first'],
      assets: [],
    };
  }

  const files = fs.readdirSync(ASSETS_DIR).sort();
  const assets = files
    .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
    .map((name) => {
      const full = path.join(ASSETS_DIR, name);
      const buf = fs.readFileSync(full);
      const gzipBytes = zlib.gzipSync(buf, { level: 9 }).length;
      return {
        name,
        rawBytes: buf.length,
        gzipBytes,
      };
    });

  const violations = [];
  const entryJs = assets.find((a) => a.name.startsWith('index-') && a.name.endsWith('.js'));
  if (!entryJs) {
    violations.push('Missing entry bundle dist/assets/index-*.js');
  } else {
    if (entryJs.rawBytes > BUDGETS.entryJsRawBytes) {
      violations.push(
        `Entry JS ${entryJs.name} exceeds raw budget (${entryJs.rawBytes} > ${BUDGETS.entryJsRawBytes})`
      );
    }
    if (entryJs.gzipBytes > BUDGETS.entryJsGzipBytes) {
      violations.push(
        `Entry JS ${entryJs.name} exceeds gzip budget (${entryJs.gzipBytes} > ${BUDGETS.entryJsGzipBytes})`
      );
    }
  }

  const entryCss = assets.find((a) => a.name.startsWith('index-') && a.name.endsWith('.css'));
  if (entryCss) {
    if (entryCss.rawBytes > BUDGETS.entryCssRawBytes) {
      violations.push(
        `Entry CSS ${entryCss.name} exceeds raw budget (${entryCss.rawBytes} > ${BUDGETS.entryCssRawBytes})`
      );
    }
    if (entryCss.gzipBytes > BUDGETS.entryCssGzipBytes) {
      violations.push(
        `Entry CSS ${entryCss.name} exceeds gzip budget (${entryCss.gzipBytes} > ${BUDGETS.entryCssGzipBytes})`
      );
    }
  }

  for (const asset of assets) {
    if (!asset.name.endsWith('.js')) continue;
    if (asset.name.startsWith('index-') || asset.name.startsWith('rolldown-runtime-')) continue;

    if (!asset.name.startsWith('vendor-')) {
      if (asset.rawBytes > BUDGETS.appRouteChunkRawBytes) {
        violations.push(
          `App route/module chunk ${asset.name} exceeds raw budget (${asset.rawBytes} > ${BUDGETS.appRouteChunkRawBytes})`
        );
      }
      if (asset.gzipBytes > BUDGETS.appRouteChunkGzipBytes) {
        violations.push(
          `App route/module chunk ${asset.name} exceeds gzip budget (${asset.gzipBytes} > ${BUDGETS.appRouteChunkGzipBytes})`
        );
      }
      continue;
    }

    for (const [prefix, cap] of Object.entries(BUDGETS.vendorBudgetsRawBytes)) {
      if (asset.name.startsWith(`${prefix}-`) && asset.rawBytes > cap) {
        violations.push(
          `Vendor chunk ${asset.name} exceeds raw budget (${asset.rawBytes} > ${cap})`
        );
      }
    }
  }

  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    violations.push('Missing dist/index.html');
  } else {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    for (const forbidden of BUDGETS.forbiddenIndexPreloads) {
      if (html.includes(forbidden)) {
        violations.push(`dist/index.html eagerly references/preloads heavy chunk "${forbidden}"`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    assets,
  };
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isCli) {
  const result = evaluateDistBundleBudgets();
  console.log('Bundle Budget Report (raw / gzip bytes):');
  for (const asset of result.assets) {
    console.log(
      `  ${asset.name.padEnd(46)} ${(asset.rawBytes / 1024).toFixed(2).padStart(8)} kB | gzip ${(asset.gzipBytes / 1024).toFixed(2).padStart(7)} kB`
    );
  }
  if (!result.ok) {
    console.error('\nBundle budget violations:');
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log('\nAll bundle size and entry preload budgets passed.');
}

