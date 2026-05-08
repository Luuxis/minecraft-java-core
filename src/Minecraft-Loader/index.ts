/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { loader as loaderFunction } from '../utils/Index.js';
import type {
	LoaderType,
	LoaderResult,
	LoaderDownloaderOptions
} from '../types.js';

// Loader sub-classes
import Forge from './loader/forge/forge.js';
import NeoForge from './loader/neoForge/neoForge.js';
import Fabric from './loader/fabric/fabric.js';
import LegacyFabric from './loader/legacyfabric/legacyFabric.js';
import Quilt from './loader/quilt/quilt.js';

export type { LoaderType };

/**
 * The main Loader class that orchestrates installation of different
 * Minecraft mod loaders (Forge, Fabric, LegacyFabric, Quilt, etc.).
 */
export default class Loader extends EventEmitter {
	private readonly options: LoaderDownloaderOptions;

	constructor(options: LoaderDownloaderOptions) {
		super();
		this.options = options;
	}

	/**
	 * Main entry point for installing the selected loader.  
	 * Checks the loader type from `this.options.loader.type` and delegates to the appropriate method.
	 * Emits:
	 *  - "error" if the loader is not found or if an installation step fails
	 *  - "json" upon successful completion, returning the version JSON or loader info
	 */
	public async install(): Promise<void> {
		// Retrieve a loader definition from your `loaderFunction`
		// (Presumably a function that returns metadata URLs, etc. based on the type.)
		const LoaderData = loaderFunction(this.options.loader.type);
		if (!LoaderData) {
			this.emit('error', { error: `Loader ${this.options.loader.type} not found` });
			return;
		}

		const loaderType = this.options.loader.type;
		let result: LoaderResult | undefined;

		switch (loaderType) {
			case 'forge': {
				result = await this.forge(LoaderData);
				break;
			}
			case 'neoforge': {
				result = await this.neoForge(LoaderData);
				break;
			}
			case 'fabric': {
				result = await this.fabric(LoaderData);
				break;
			}
			case 'legacyfabric': {
				result = await this.legacyFabric(LoaderData);
				break;
			}
			case 'quilt': {
				result = await this.quilt(LoaderData);
				break;
			}
			default: {
				this.emit('error', { error: `Loader ${loaderType} not found` });
				return;
			}
		}

		// If there's an error property, emit it. Otherwise, emit the final JSON.
		if (result && result.error) {
			this.emit('error', result);
		} else if (result) {
			this.emit('json', result);
		}
	}

	/**
	 * Handles Forge installation by:
	 *  1. Downloading the installer
	 *  2. Depending on installer type, extracting an install profile or creating a merged Jar
	 *  3. Downloading required libraries
	 *  4. Patching Forge if necessary
	 *  5. Returns the final version JSON object or an error
	 */
	private async forge(LoaderData: any): Promise<LoaderResult> {
		const forge = new Forge(this.options);

		// Forward Forge events
		forge.on('check', (progress: number, size: number, element: string) => {
			this.emit('check', progress, size, element);
		});
		forge.on('progress', (progress: number, size: number, element: string) => {
			this.emit('progress', progress, size, element);
		});
		forge.on('extract', (element: string) => {
			this.emit('extract', element);
		});
		forge.on('patch', (patch: any) => {
			this.emit('patch', patch);
		});

		// 1. Download installer
		const installer: any = await forge.downloadInstaller(LoaderData as any);
		if (installer.error) return installer;

		const profile: any = await forge.extractProfile(installer.filePath);
		if (profile.error) return profile;

		// Write the version JSON to disk
		if ("version" in profile && "id" in profile.version) {
			const destination = path.resolve(this.options.path, 'versions', profile.version.id);
			if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true });
			fs.writeFileSync(path.resolve(destination, `${profile.version.id}.json`), JSON.stringify(profile.version, null, 4));
			fs.cpSync(path.resolve(this.options.loader.config.minecraftJar), path.resolve(destination, `${profile.version.id}.jar`));
		}

		// 3. Extract universal jar if needed
		const universal: any = await forge.extractUniversalJar(profile.install, installer.filePath);
		if (universal.error) return universal;

		// 4. Download libraries
		const libraries: any = await forge.downloadLibraries(profile, universal);
		if (libraries.error) return libraries;

		// 5. Patch Forge if necessary
		const patch: any = await forge.patchForge(profile.install);
		if (patch.error) return patch;

		return profile.version;
	}

	/**
	 * Manages installation flow for NeoForge:
	 *  1. Download the installer
	 *  2. Extract the install profile
	 *  3. Extract the universal jar
	 *  4. Download libraries
	 *  5. Patch if needed
	 */
	private async neoForge(LoaderData: any): Promise<LoaderResult> {
		const neoForge = new NeoForge(this.options);

		// Forward events
		neoForge.on('check', (progress: number, size: number, element: string) => {
			this.emit('check', progress, size, element);
		});
		neoForge.on('progress', (progress: number, size: number, element: string) => {
			this.emit('progress', progress, size, element);
		});
		neoForge.on('extract', (element: string) => {
			this.emit('extract', element);
		});
		neoForge.on('patch', (patch: any) => {
			this.emit('patch', patch);
		});

		const installer = await neoForge.downloadInstaller(LoaderData as any);
		if ('error' in installer) return installer as LoaderResult;

		// Extract the main profile
		const profile: any = await neoForge.extractProfile(installer.filePath);
		if (profile.error) return profile;
		if (!profile.install) return { error: 'Invalid neoForge profile' };

		// Write version JSON
		if ("version" in profile && "id" in profile.version) {
			const destination = path.resolve(this.options.path, 'versions', profile.version.id);
			if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true });
			fs.writeFileSync(path.resolve(destination, `${profile.version.id}.json`), JSON.stringify(profile.version, null, 4));
			fs.cpSync(path.resolve(this.options.loader.config.minecraftJar), path.resolve(destination, `${profile.version.id}.jar`));
		}
		// Extract universal jar
		const universal: any = await neoForge.extractUniversalJar(profile.install, installer.filePath, installer.oldAPI);
		if (universal.error) return universal;

		// Download libraries
		const libraries: any = await neoForge.downloadLibraries(profile, universal);
		if (libraries.error) return libraries;

		// Patch if needed
		const patch: any = await neoForge.patchneoForge(profile.install, installer.oldAPI);
		if (patch.error) return patch;

		if ("version" in profile && profile.version) return profile.version;
		return { error: 'Invalid neoForge profile' };
	}

	/**
	 * Installs Fabric:
	 *  1. Download the loader JSON
	 *  2. Save it as a version .json
	 *  3. Download required libraries
	 */
	private async fabric(LoaderData: any): Promise<LoaderResult> {
		const fabric = new Fabric(this.options);

		// Forward events
		fabric.on('check', (progress: number, size: number, element: string) => {
			this.emit('check', progress, size, element);
		});
		fabric.on('progress', (progress: number, size: number, element: string) => {
			this.emit('progress', progress, size, element);
		});

		const json = await fabric.downloadJson(LoaderData);
		if (json.error) return json;

		if ("id" in json && typeof json.id === 'string') {
			const destination = path.resolve(this.options.path, 'versions', json.id);
			if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true });
			fs.writeFileSync(path.resolve(destination, `${json.id}.json`), JSON.stringify(json, null, 4));
			fs.cpSync(path.resolve(this.options.loader.config.minecraftJar), path.resolve(destination, `${json.id}.jar`));
		}

		if ("libraries" in json) {
			await fabric.downloadLibraries(json);
		}

		return json;
	}

	/**
	 * Installs Legacy Fabric:
	 *  1. Download JSON
	 *  2. Save version .json
	 *  3. Download libraries
	 */
	private async legacyFabric(LoaderData: any): Promise<LoaderResult> {
		const legacyFabric = new LegacyFabric(this.options);

		// Forward events
		legacyFabric.on('check', (progress: number, size: number, element: string) => {
			this.emit('check', progress, size, element);
		});
		legacyFabric.on('progress', (progress: number, size: number, element: string) => {
			this.emit('progress', progress, size, element);
		});

		const json = await legacyFabric.downloadJson(LoaderData);
		if (json.error) return json;

		if ("id" in json && typeof json.id === 'string') {
			const destination = path.resolve(this.options.path, 'versions', json.id);
			if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true });
			fs.writeFileSync(path.resolve(destination, `${json.id}.json`), JSON.stringify(json, null, 4));
			fs.cpSync(path.resolve(this.options.loader.config.minecraftJar), path.resolve(destination, `${json.id}.jar`));
		}
		if ("libraries" in json) {
			await legacyFabric.downloadLibraries(json);
		}
		return json;
	}

	/**
	 * Installs Quilt:
	 *  1. Download the loader JSON
	 *  2. Write to a version file
	 *  3. Download required libraries
	 */
	private async quilt(LoaderData: any): Promise<LoaderResult> {
		const quilt = new Quilt(this.options);

		// Forward events
		quilt.on('check', (progress: number, size: number, element: string) => {
			this.emit('check', progress, size, element);
		});
		quilt.on('progress', (progress: number, size: number, element: string) => {
			this.emit('progress', progress, size, element);
		});

		const json = await quilt.downloadJson(LoaderData);
		if ('error' in json && json.error) return json as LoaderResult;

		if ("id" in json) {
			const destination = path.resolve(this.options.path, 'versions', json.id as string);
			if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true });
			fs.writeFileSync(path.resolve(destination, `${json.id as string}.json`), JSON.stringify(json, null, 4));
			fs.cpSync(path.resolve(this.options.loader.config.minecraftJar), path.resolve(destination, `${json.id as string}.jar`));
		}
		if ("libraries" in json) {
			await quilt.downloadLibraries(json);
		}

		return json;
	}
}
