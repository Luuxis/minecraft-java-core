/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import { EventEmitter } from 'events';
import path from 'path';
import LoaderDownloader from '../Minecraft-Loader/index.js';
import type {
	LaunchOptions,
	LoaderJSON,
	LoaderArguments,
	LoaderType
} from '../types.js';

/**
 * This class manages the installation and argument-building for a Minecraft
 * mod loader (e.g. Forge, Fabric). It wraps a `LoaderDownloader` and emits
 * the same events for progress, extraction, patching, etc.
 */
export default class MinecraftLoader extends EventEmitter {
	private options: LaunchOptions;
	private loaderPath: string;

	constructor(options: LaunchOptions) {
		super();
		this.options = options;
		this.loaderPath = path.join(this.options.path, this.options.loader.path!);
	}

	/**
	 * Installs the loader for a given Minecraft version using a LoaderDownloader,
	 * returning the loader's JSON on completion. This function emits several events
	 * for progress reporting and patch notifications.
	 *
	 * @param version  The Minecraft version (e.g. "1.19.2")
	 * @param javaPath Path to the Java executable used by the loader for patching
	 * @returns        A Promise that resolves to the loader's JSON configuration
	 */
	public async GetLoader(version: string, javaPath: string): Promise<LoaderJSON> {
		const loader = new LoaderDownloader({
			path: this.loaderPath,
			downloadFileMultiple: this.options.downloadFileMultiple,
			loader: {
				type: this.options.loader.type! as LoaderType,
				version: version,
				build: this.options.loader.build!,
				config: {
					javaPath,
					minecraftJar: `${this.options.path}/versions/${version}/${version}.jar`,
					minecraftJson: `${this.options.path}/versions/${version}/${version}.json`
				}
			}
		});

		return new Promise<LoaderJSON>((resolve, reject) => {
			loader.install();

			loader.on('json', (json: LoaderJSON) => {
				const modifiedJson = json;
				if (modifiedJson.libraries) {
					modifiedJson.libraries = modifiedJson.libraries.map(lib => {
						lib.loader = this.loaderPath;
						return lib;
					});
				}
				resolve(modifiedJson);
			});

			loader.on('extract', (extract: string) => {
				this.emit('extract', extract);
			});

			loader.on('progress', (progress: number, size: number, element: string) => {
				this.emit('progress', progress, size, element);
			});

			loader.on('check', (progress: number, size: number, element: string) => {
				this.emit('check', progress, size, element);
			});

			loader.on('patch', (patch: string) => {
				this.emit('patch', patch);
			});

			loader.on('error', (err: Error) => {
				reject(err);
			});
		});
	}

	public async GetArguments(json: LoaderJSON | null, version: string): Promise<LoaderArguments> {
		// If no loader JSON is provided, return empty arrays
		if (json === null) {
			return { game: [], jvm: [] };
		}

		const moddedArgs = json.arguments;
		if (!moddedArgs) return { game: [], jvm: [] };

		const args: LoaderArguments = { game: [], jvm: [] };

		if (moddedArgs.game) {
			args.game = moddedArgs.game;
		}

		if (moddedArgs.jvm) {
			args.jvm = moddedArgs.jvm.map((jvmArg) =>
				jvmArg
					.replace(/\${version_name}/g, version)
					.replace(/\${library_directory}/g, `${this.loaderPath}/libraries`)
					.replace(/\${classpath_separator}/g, process.platform === 'win32' ? ';' : ':')
			);
		}

		args.mainClass = json.mainClass;
		return args;
	}
}
