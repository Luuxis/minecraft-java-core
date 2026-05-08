#!/usr/bin/env node
/**
 * @author Luuxis
 * Luuxis License v1.0 (see LICENSE file for FR/EN details)
 */

import fs from 'fs';
import path from 'path';
import { spawnSync, execSync } from 'child_process';

export interface ZipperOptions {
	keep: boolean;
	dryRun: boolean;
	level: number;
	dirs: string[];
	target: string | null;
}

export interface ZipperResult {
	processed: number;
	skipped: number;
	totalBefore: number;
	totalAfter: number;
}

const DEFAULT_OPTIONS: ZipperOptions = {
	keep: false,
	dryRun: false,
	level: 9,
	dirs: ['resourcepacks', 'shaderpacks', 'datapacks'],
	target: null,
};

const HELP_TEXT = `mjc-zip — Compress subfolders of resourcepacks/shaderpacks/datapacks.

Usage:
  npx mjc-zip [target] [options]

Arguments:
  target              Instance folder to process (default: cwd)

Options:
  --keep              Keep original folders after compression
  --dry-run, -n       Do not write anything, only show what would be done
  --level=0..9        Zip compression level (default: 9)
  --dirs=a,b,c        Subfolders to process (default: resourcepacks,shaderpacks,datapacks)
  -h, --help          Show this help`;

function parseArgs(argv: string[]): ZipperOptions {
	const opts: ZipperOptions = { ...DEFAULT_OPTIONS, dirs: [...DEFAULT_OPTIONS.dirs] };

	for (const a of argv) {
		if (a === '--keep') {
			opts.keep = true;
		} else if (a === '--dry-run' || a === '-n') {
			opts.dryRun = true;
		} else if (a.startsWith('--level=')) {
			const parsed = parseInt(a.split('=')[1], 10);
			opts.level = Math.max(0, Math.min(9, Number.isNaN(parsed) ? 9 : parsed));
		} else if (a.startsWith('--dirs=')) {
			opts.dirs = a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
		} else if (a === '-h' || a === '--help') {
			console.log(HELP_TEXT);
			process.exit(0);
		} else if (!a.startsWith('-') && opts.target === null) {
			opts.target = a;
		} else {
			console.error(`❌ Unknown argument: ${a}`);
			process.exit(1);
		}
	}

	return opts;
}

function hasZipCommand(): boolean {
	try {
		execSync('zip -v', { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function dirSize(dir: string): number {
	let total = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) total += dirSize(p);
		else if (entry.isFile()) total += fs.statSync(p).size;
	}
	return total;
}

function fmtBytes(n: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return `${n.toFixed(2)} ${units[i]}`;
}

function rmDir(p: string): void {
	fs.rmSync(p, { recursive: true, force: true });
}

export function runZipper(options: Partial<ZipperOptions> = {}): ZipperResult {
	const opts: ZipperOptions = {
		...DEFAULT_OPTIONS,
		...options,
		dirs: options.dirs ?? [...DEFAULT_OPTIONS.dirs],
	};

	const root = path.resolve(process.cwd(), opts.target || '.');

	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
		throw new Error(`Folder not found: ${root}`);
	}

	if (!hasZipCommand()) {
		throw new Error(
			'The "zip" system command was not found. macOS/Linux: already installed. Windows: use WSL or install Info-ZIP.',
		);
	}

	console.log(`📁 Target: ${root}`);

	let totalBefore = 0;
	let totalAfter = 0;
	let processed = 0;
	let skipped = 0;

	for (const sub of opts.dirs) {
		const base = path.join(root, sub);
		if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
			console.log(`• ${sub}/ : not found, skipped`);
			continue;
		}

		console.log(`\n=== ${sub}/ ===`);
		const entries = fs.readdirSync(base, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const srcDir = path.join(base, entry.name);
			const zipPath = path.join(base, `${entry.name}.zip`);

			if (fs.existsSync(zipPath)) {
				console.log(`  - ${entry.name} : ${path.basename(zipPath)} already exists, skipped`);
				skipped++;
				continue;
			}

			const sizeBefore = dirSize(srcDir);
			console.log(`  → ${entry.name} (${fmtBytes(sizeBefore)})`);

			if (opts.dryRun) {
				processed++;
				totalBefore += sizeBefore;
				continue;
			}

			const result = spawnSync(
				'zip',
				['-r', '-q', `-${opts.level}`, zipPath, entry.name],
				{ cwd: base, stdio: 'inherit' },
			);

			if (result.status !== 0) {
				console.error(`    ✗ failed to compress ${entry.name}`);
				if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
				continue;
			}

			const sizeAfter = fs.statSync(zipPath).size;
			const ratio = sizeBefore > 0 ? 100 - (sizeAfter / sizeBefore) * 100 : 0;
			console.log(`    ✓ ${fmtBytes(sizeBefore)} → ${fmtBytes(sizeAfter)}  (-${ratio.toFixed(1)}%)`);

			totalBefore += sizeBefore;
			totalAfter += sizeAfter;
			processed++;

			if (!opts.keep) {
				rmDir(srcDir);
			}
		}
	}

	console.log('\n────────────────────────────────────────');
	console.log(`Folders processed: ${processed}`);
	console.log(`Folders skipped : ${skipped}`);
	if (!opts.dryRun && processed > 0) {
		const saved = totalBefore - totalAfter;
		const ratio = totalBefore > 0 ? (saved / totalBefore) * 100 : 0;
		console.log(`Before: ${fmtBytes(totalBefore)}`);
		console.log(`After : ${fmtBytes(totalAfter)}`);
		console.log(`Saved : ${fmtBytes(saved)}  (-${ratio.toFixed(1)}%)`);
		if (!opts.keep) console.log('Original folders have been removed.');
		else console.log('Original folders have been kept (--keep).');
	} else if (opts.dryRun) {
		console.log('(--dry-run) no changes were made.');
	}

	return { processed, skipped, totalBefore, totalAfter };
}

if (require.main === module) {
	try {
		const opts = parseArgs(process.argv.slice(2));
		runZipper(opts);
	} catch (err) {
		console.error(`❌ ${(err as Error).message}`);
		process.exit(1);
	}
}
