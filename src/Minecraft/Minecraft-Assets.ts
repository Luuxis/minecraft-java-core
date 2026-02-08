/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
import fs from 'fs';
import type { AssetItem, LaunchOptions, MinecraftVersionJSON } from '../types.js';

/**
 * Class responsible for handling Minecraft asset index fetching
 * and optionally copying legacy assets to the correct directory.
 */
export default class MinecraftAssets {
	private assetIndex: { id: string; url: string } | undefined;
	private readonly options: LaunchOptions;

	constructor(options: LaunchOptions) {
		this.options = options;
	}

	/**
	 * Fetches the asset index from the provided JSON object, then constructs
	 * and returns an array of asset download objects. These can be processed
	 * by a downloader to ensure all assets are present locally.
	 *
	 * @param versionJson A JSON object containing an "assetIndex" field.
	 * @returns An array of AssetItem objects with download info.
	 */
	public async getAssets(versionJson: MinecraftVersionJSON): Promise<AssetItem[]> {
		this.assetIndex = versionJson.assetIndex;
		if (!this.assetIndex) {
			// If there's no assetIndex, there's nothing to download.
			return [];
		}

		// Fetch the asset index JSON from the remote URL
		let data;
		try {
			const response = await fetch(this.assetIndex.url);
			data = await response.json();
		} catch (err: any) {
			throw new Error(`Failed to fetch asset index: ${err.message}`);
		}

		// First item is the index file itself, which we'll store locally
		const assetsArray: AssetItem[] = [
			{
				type: 'CFILE',
				path: `assets/indexes/${this.assetIndex.id}.json`,
				content: JSON.stringify(data)
			}
		];

		// Convert the "objects" property into a list of individual assets
		const objects = Object.values(data.objects || {});
		for (const obj of objects as Array<{ hash: string; size: number }>) {
			assetsArray.push({
				type: 'Assets',
				sha1: obj.hash,
				size: obj.size,
				path: `assets/objects/${obj.hash.substring(0, 2)}/${obj.hash}`,
				url: `https://resources.download.minecraft.net/${obj.hash.substring(0, 2)}/${obj.hash}`
			});
		}

		return assetsArray;
	}

	/**
	 * Copies legacy assets (when using older versions of Minecraft) from
	 * the main "objects" folder to a "resources" folder, preserving the
	 * directory structure.
	 *
	 * @param versionJson A JSON object that has an "assets" property for the index name.
	 */
	public copyAssets(versionJson: MinecraftVersionJSON): void {
		// Determine the legacy directory where resources should go
		let legacyDirectory = `${this.options.path}/resources`;
		if (this.options.instance) {
			legacyDirectory = `${this.options.path}/instances/${this.options.instance}/resources`;
		}

		// The path to the local asset index JSON
		const pathAssets = `${this.options.path}/assets/indexes/${versionJson.assets}.json`;
		if (!fs.existsSync(pathAssets)) {
			return; // Nothing to copy if the file doesn't exist
		}

		// Parse the asset index JSON
		let assetsData;
		try {
			assetsData = JSON.parse(fs.readFileSync(pathAssets, 'utf-8'));
		} catch (err: any) {
			throw new Error(`Failed to read assets index file: ${err.message}`);
		}

		// Each entry is [filePath, { hash, size }]
		const assetsEntries = Object.entries(assetsData.objects || {});
		for (const [filePath, hashData] of assetsEntries) {
			const hashObj = hashData as { hash: string; size: number };
			const fullHash = hashObj.hash;
			const subHash = fullHash.substring(0, 2);

			// Directory where the hashed file is stored
			const subAssetDir = `${this.options.path}/assets/objects/${subHash}`;

			// If needed, create the corresponding directories in the legacy folder
			const pathSegments = filePath.split('/');
			pathSegments.pop(); // Remove the last segment (the filename itself)
			if (!fs.existsSync(`${legacyDirectory}/${pathSegments.join('/')}`)) {
				fs.mkdirSync(`${legacyDirectory}/${pathSegments.join('/')}`, { recursive: true });
			}

			// Copy the file if it doesn't already exist in the legacy location
			const sourceFile = `${subAssetDir}/${fullHash}`;
			const targetFile = `${legacyDirectory}/${filePath}`;
			if (!fs.existsSync(targetFile)) {
				fs.copyFileSync(sourceFile, targetFile);
			}
		}
	}
}
