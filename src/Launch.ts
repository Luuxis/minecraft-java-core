/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

import jsonMinecraft from './Minecraft/Minecraft-Json.js';
import librariesMinecraft from './Minecraft/Minecraft-Libraries.js';
import assetsMinecraft from './Minecraft/Minecraft-Assets.js';
import loaderMinecraft from './Minecraft/Minecraft-Loader.js';
import javaMinecraft from './Minecraft/Minecraft-Java.js';
import bundleMinecraft from './Minecraft/Minecraft-Bundle.js';
import argumentsMinecraft from './Minecraft/Minecraft-Arguments.js';

import { isold } from './utils/Index.js';
import Downloader from './utils/Downloader.js';
import type {
	LaunchOptions,
	LaunchArguments,
	LoaderArguments,
	LoaderJSON,
	MinecraftVersionJSON,
	JavaDownloadResult,
	DownloadFile,
} from './types.js';

type LaunchInputOptions = Partial<Omit<LaunchOptions, 'authenticator' | 'loader' | 'java' | 'screen' | 'memory'>> & {
	authenticator?: LaunchOptions['authenticator'] | null;
	loader?: Partial<LaunchOptions['loader']>;
	java?: Partial<LaunchOptions['java']> & { path?: string | null; version?: string | null };
	screen?: Partial<LaunchOptions['screen']> & { width?: number | null; height?: number | null };
	memory?: Partial<LaunchOptions['memory']>;
};

export type LaunchOPTS = LaunchInputOptions;

export default class Launch extends EventEmitter {
	options!: LaunchOptions;

	async Launch(opt: LaunchInputOptions = {}) {
		const defaultOptions: LaunchOptions = {
			url: opt.url ?? null,
			authenticator: opt.authenticator,
			timeout: opt.timeout ?? 10000,
			path: opt.path ?? '.Minecraft',
			version: opt.version ?? 'latest_release',
			instance: opt.instance ?? null,
			detached: opt.detached ?? false,
			intelEnabledMac: opt.intelEnabledMac ?? false,
			ignore_log4j: opt.ignore_log4j ?? false,
			downloadFileMultiple: opt.downloadFileMultiple ?? 5,
			bypassOffline: opt.bypassOffline ?? false,

			loader: {
				path: opt.loader?.path ?? './loader',
				type: opt.loader?.type ?? null,
				build: opt.loader?.build ?? 'latest',
				enable: opt.loader?.enable ?? false,
			},

			mcp: opt.mcp ?? null,

			verify: opt.verify ?? false,
			ignored: opt.ignored ?? [],
			JVM_ARGS: opt.JVM_ARGS ?? [],
			GAME_ARGS: opt.GAME_ARGS ?? [],

			java: {
				path: opt.java?.path ?? null,
				version: opt.java?.version ?? null,
				type: opt.java?.type ?? 'jre',
			},

			screen: {
				width: opt.screen?.width ?? null,
				height: opt.screen?.height ?? null,
				fullscreen: opt.screen?.fullscreen ?? false,
			},

			memory: {
				min: opt.memory?.min ?? '1G',
				max: opt.memory?.max ?? '2G'
			}
		} as LaunchOptions;

		this.options = defaultOptions;
		this.options.path = path.resolve(this.options.path).replace(/\\/g, '/');

		if (this.options.mcp) {
			if (this.options.instance) this.options.mcp = `${this.options.path}/instances/${this.options.instance}/${this.options.mcp}`
			else this.options.mcp = path.resolve(`${this.options.path}/${this.options.mcp}`).replace(/\\/g, '/')
		}

		if (this.options.loader.type) {
			this.options.loader.type = this.options.loader.type.toLowerCase()
			this.options.loader.build = (this.options.loader.build ?? 'latest').toLowerCase()
		}

		if (!this.options.authenticator) return this.emit("error", { error: "Authenticator not found" });
		this.options.downloadFileMultiple = Math.min(30, Math.max(1, this.options.downloadFileMultiple ?? 5));
		if (typeof this.options.loader.path !== 'string') this.options.loader.path = `./loader/${this.options.loader.type}`;
		if (this.options.java.version && typeof this.options.java.type !== 'string') this.options.java.type = 'jre';
		this.start();
	}


	async start() {
		let data = await this.DownloadGame();
		if (!data || 'error' in data) return this.emit('error', data);
		let { minecraftJson, minecraftLoader, minecraftVersion, minecraftJava } = data;

		let minecraftArguments: LaunchArguments | { error: string } = await new argumentsMinecraft(this.options).GetArguments(minecraftJson, minecraftLoader ?? undefined);
		if ('error' in minecraftArguments) return this.emit('error', minecraftArguments);
		if (!minecraftArguments.mainClass) return this.emit('error', { error: 'Minecraft main class not found' });

		let loaderArguments: LoaderArguments | { error: string } = await new loaderMinecraft(this.options).GetArguments(minecraftLoader, minecraftVersion);
		if ('error' in loaderArguments) return this.emit('error', loaderArguments);

		let Arguments: string[] = [
			...minecraftArguments.jvm,
			...minecraftArguments.classpath,
			...loaderArguments.jvm,
			minecraftArguments.mainClass,
			...minecraftArguments.game,
			...loaderArguments.game
		]

		let java: string = this.options.java.path ? this.options.java.path : minecraftJava.path;
		let logs = this.options.instance ? `${this.options.path}/instances/${this.options.instance}` : this.options.path;
		if (!fs.existsSync(logs)) fs.mkdirSync(logs, { recursive: true });

		let argumentsLogs: string = Arguments.join(' ')
		const hiddenValues = [
			this.options.authenticator.access_token,
			this.options.authenticator.client_token,
			this.options.authenticator.uuid,
			this.options.authenticator.xboxAccount?.xuid
		].filter((value): value is string => typeof value === 'string' && value.length > 0);

		for (const value of hiddenValues) argumentsLogs = argumentsLogs.replaceAll(value, '????????');
		argumentsLogs = argumentsLogs.replaceAll(`${this.options.path}/`, '');
		this.emit('data', `Launching with arguments ${argumentsLogs}`);

		let minecraftDebug = spawn(java, Arguments, { cwd: logs, detached: this.options.detached })
		minecraftDebug.stdout.on('data', data => {
			data = data.toString('utf-8');
			for (const value of hiddenValues) data = data.replaceAll(value, '????????');
			return this.emit('data', data);
		})
		minecraftDebug.stderr.on('data', data => {
			data = data.toString('utf-8');
			for (const value of hiddenValues) data = data.replaceAll(value, '????????');
			return this.emit('data', data);
		})
		minecraftDebug.on('close', code => {
			return this.emit('close', code);
		})
	}

	async DownloadGame(): Promise<{ minecraftJson: MinecraftVersionJSON; minecraftLoader: LoaderJSON | null; minecraftVersion: string; minecraftJava: JavaDownloadResult } | void> {
		const InfoVersion = await new jsonMinecraft(this.options).GetInfoVersion();
		let loaderJson: LoaderJSON | null = null;
		if ('error' in InfoVersion) { this.emit('error', InfoVersion); return; }

		const { json, version } = InfoVersion;

		const libraries = new librariesMinecraft(this.options)

		const bundle = new bundleMinecraft(this.options)
		const java = new javaMinecraft(this.options)

		bundle.on('check', (progress: number, size: number, element: string) => {
			this.emit('check', progress, size, element);
		});

		java.on('progress', (progress: number, size: number, element: string) => {
			this.emit('progress', progress, size, element)
		});

		java.on('extract', (progress: string) => {
			this.emit('extract', progress)
		});

		const gameLibraries: DownloadFile[] = await libraries.Getlibraries(json);
		const gameLogging: DownloadFile[] = await libraries.GetLogging();
		const gameAssetsOther: DownloadFile[] = await libraries.GetAssetsOthers(this.options.url ?? null);
		const gameAssets: DownloadFile[] = await new assetsMinecraft(this.options).getAssets(json);
		const gameJava: JavaDownloadResult = this.options.java.path ? { files: [], path: this.options.java.path } : await java.getJavaFiles(json);


		if ('error' in gameJava) { this.emit('error', gameJava); return; }

		const filesList: DownloadFile[] = await bundle.checkBundle([...gameLibraries, ...gameLogging, ...gameAssetsOther, ...gameAssets, ...gameJava.files]);

		if (filesList.length > 0) {
			let downloader = new Downloader();
			let totsize = await bundle.getTotalSize(filesList);

			downloader.on("progress", (DL: number, totDL: number, element: string) => {
				this.emit("progress", DL, totDL, element);
			});

			downloader.on("speed", (speed: number) => {
				this.emit("speed", speed);
			});

			downloader.on("estimated", (time: number) => {
				this.emit("estimated", time);
			});

			downloader.on("error", (e: Error) => {
				this.emit("error", e);
			});

			await downloader.downloadFileMultiple(filesList, totsize, this.options.downloadFileMultiple, this.options.timeout);
		}

		if (this.options.loader.enable === true) {
			const loaderInstall = new loaderMinecraft(this.options)

			loaderInstall.on('extract', (extract: string) => {
				this.emit('extract', extract);
			});

			loaderInstall.on('progress', (progress: number, size: number, element: string) => {
				this.emit('progress', progress, size, element);
			});

			loaderInstall.on('check', (progress: number, size: number, element: string) => {
				this.emit('check', progress, size, element);
			});

			loaderInstall.on('patch', (patch: string) => {
				this.emit('patch', patch);
			});

			const jsonLoader = await loaderInstall.GetLoader(version, this.options.java.path ? this.options.java.path : gameJava.path)
				.then((data: LoaderJSON) => data)
				.catch((err: Error) => ({ error: err.message }));
			if ('error' in jsonLoader) { this.emit('error', jsonLoader); return; }
			loaderJson = jsonLoader;
		}

		if (this.options.verify) await bundle.checkFiles([...gameLibraries, ...gameAssetsOther, ...gameAssets, ...gameJava.files]);

		const natives = await libraries.natives(gameLibraries);
		if (natives.length === 0) json.nativesList = false;
		else json.nativesList = true;

		if (isold(json)) new assetsMinecraft(this.options).copyAssets(json);

		return {
			minecraftJson: json,
			minecraftLoader: loaderJson,
			minecraftVersion: version,
			minecraftJava: gameJava
		}
	}
}