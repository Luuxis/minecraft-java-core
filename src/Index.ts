/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import AZauth from './Authenticator/AZauth.js';
import Launch from './Launch.js';
import Microsoft from './Authenticator/Microsoft.js';
import * as Mojang from './Authenticator/Mojang.js';
import Status from './StatusServer/status.js';
import Downloader from './utils/Downloader.js';

// Re-export types for consumers
export type {
    LaunchOptions,
    LaunchArguments,
    LoaderArguments,
    LoaderConfig,
    LoaderJSON,
    LoaderType,
    Authenticator,
    MinecraftVersionJSON,
    JavaDownloadResult,
    DownloadFile,
    ScreenOptions,
    MemoryOptions,
    JavaOptions,
    MicrosoftAuthResponse,
    AZauthUser,
    MojangAuthResponse,
} from './types.js';

export {
    AZauth as AZauth,
    Launch as Launch,
    Microsoft as Microsoft,
    Mojang as Mojang,
    Status as Status,
    Downloader as Downloader
};