/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { MinecraftVersionJSON, MinecraftLibrary, LaunchOptions } from '../types.js';

/**
 * This class modifies the version JSON for ARM-based Linux systems,
 * specifically handling LWJGL library replacements.
 */
export default class MinecraftLoader {
	private options: LaunchOptions;

	constructor(options: LaunchOptions) {
		this.options = options;
	}

	/**
	 * Processes a Minecraft version JSON, removing default JInput and LWJGL entries
	 * if needed, then injecting ARM-compatible LWJGL libraries from local JSON files.
	 *
	 * @param version A MinecraftVersion object containing a list of libraries
	 * @returns The same version object, but with updated libraries for ARM-based Linux
	 */
	public async ProcessJson(version: MinecraftVersionJSON): Promise<MinecraftVersionJSON> {
		// Maps Node's arm architecture to the expected LWJGL naming
		const archMapping: Record<string, string> = {
			arm64: 'aarch64',
			arm: 'aarch'
		};
		const currentArch = os.arch();
		const mappedArch = archMapping[currentArch];

		// If running on a non-ARM environment, or if the mapping doesn't exist, no changes are needed
		if (!mappedArch) {
			return version;
		}

		// Path to the directory containing LWJGL JSON files for ARM
		const pathLWJGL = path.join(__dirname, '../../assets/LWJGL', mappedArch);

		// Identify the version strings for JInput and LWJGL from the existing libraries
		const versionJinput = version.libraries.find(lib =>
			lib.name.startsWith('net.java.jinput:jinput-platform:') ||
			lib.name.startsWith('net.java.jinput:jinput:')
		)?.name.split(':').pop();

		const versionLWJGL = version.libraries.find(lib =>
			lib.name.startsWith('org.lwjgl:lwjgl:') ||
			lib.name.startsWith('org.lwjgl.lwjgl:lwjgl:')
		)?.name.split(':').pop();

		// Remove all JInput-related libraries if a JInput version is found
		if (versionJinput) {
			version.libraries = version.libraries.filter(lib => !lib.name.includes('jinput'));
		}

		// Remove all LWJGL-related libraries if an LWJGL version is found
		if (versionLWJGL) {
			version.libraries = version.libraries.filter(lib => !lib.name.includes('lwjgl'));

			// Inject ARM-compatible LWJGL libraries
			let lwjglJsonFile = versionLWJGL.includes('2.9')
				? '2.9.4.json'
				: `${versionLWJGL}.json`;

			const lwjglPath = path.join(pathLWJGL, lwjglJsonFile);

			// Read the appropriate LWJGL JSON (e.g., "2.9.4.json" or "<versionLWJGL>.json")
			const lwjglNativesContent = fs.readFileSync(lwjglPath, 'utf-8');
			const lwjglNatives = JSON.parse(lwjglNativesContent) as { libraries: MinecraftLibrary[] };

			// Append the ARM-compatible libraries
			version.libraries.push(...lwjglNatives.libraries);
		}

		return version;
	}
}
