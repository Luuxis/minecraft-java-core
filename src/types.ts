/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 *
 * Centralized type definitions for minecraft-java-core.
 * All shared types are defined here for easier maintenance.
 */

// ========================
// Authenticator Types
// ========================

/** Microsoft OAuth client environment type */
export type MicrosoftClientType = 'electron' | 'nwjs' | 'terminal';

/** A Minecraft skin/cape entry */
export interface MinecraftSkin {
    id?: string;
    state?: string;
    url?: string;
    variant?: string;
    alias?: string;
    base64?: string;
}

/** Minecraft profile returned by Mojang API */
export interface MinecraftProfile {
    id: string;
    name: string;
    skins?: MinecraftSkin[];
    capes?: MinecraftSkin[];
}

/** Authentication error structure */
export interface AuthError {
    error: string;
    errorType?: string;
    [key: string]: unknown;
}

/** Microsoft authentication successful response */
export interface MicrosoftAuthResponse {
    access_token: string;
    client_token: string;
    uuid: string;
    name: string;
    refresh_token: string;
    user_properties: string;
    meta: {
        type: 'Xbox';
        access_token_expires_in: number;
        demo: boolean;
    };
    xboxAccount: {
        xuid: string;
        gamertag: string;
        ageGroup: string;
    };
    profile: {
        skins?: MinecraftSkin[];
        capes?: MinecraftSkin[];
    };
}

/** AZauth user info */
export interface AZauthUserInfo {
    id?: string;
    banned?: boolean;
    money?: number;
    role?: string;
    verified?: boolean;
}

/** AZauth user returned by the AZauth API */
export interface AZauthUser {
    access_token?: string;
    client_token?: string;
    uuid?: string;
    name?: string;
    user_properties?: string;
    user_info?: AZauthUserInfo;
    meta?: {
        online: boolean;
        type: string;
    };
    profile?: {
        skins: Array<{
            url: string;
            base64?: string;
        }>;
    };
    error?: boolean;
    reason?: string;
    message?: string;
    A2F?: boolean;
}

/** Mojang authentication response */
export interface MojangAuthResponse {
    access_token: string;
    client_token: string;
    uuid: string;
    name: string;
    user_properties: string;
    meta: {
        online: boolean;
        type: 'Mojang';
    };
    error?: string;
    errorMessage?: string;
}

/** Generic authenticator result — union of all auth providers */
export type AuthenticatorResult = MicrosoftAuthResponse | AZauthUser | MojangAuthResponse;

/** Authenticator object used at runtime (common fields across all auth methods) */
export interface Authenticator {
    access_token: string;
    client_token: string;
    uuid: string;
    name: string;
    user_properties: string;
    meta: {
        online?: boolean;
        type: string;
        access_token_expires_in?: number;
        demo?: boolean;
    };
    xboxAccount?: {
        xuid: string;
        gamertag: string;
        ageGroup: string;
    };
    clientId?: string;
    profile?: {
        skins?: MinecraftSkin[];
        capes?: MinecraftSkin[];
    };
}

// ========================
// Loader Types
// ========================

/** Supported loader types */
export type LoaderType = 'forge' | 'neoforge' | 'fabric' | 'legacyfabric' | 'quilt';

/** Loader configuration in LaunchOptions */
export interface LoaderConfig {
    /** Path to loader directory, relative to the Minecraft root. Defaults to `./loader/<type>`. */
    path?: string;
    /** Loader type */
    type?: LoaderType | string | null;
    /** Loader build version. `'latest'`, `'recommended'`, or a specific version. */
    build?: string;
    /** Should the launcher use a loader? */
    enable?: boolean;
}

/** Loader JSON structure (returned after installation) */
export interface LoaderJSON {
    id?: string;
    mainClass?: string;
    libraries?: LoaderLibrary[];
    minecraftArguments?: string;
    isOldForge?: boolean;
    jarPath?: string;
    arguments?: {
        game?: string[];
        jvm?: string[];
    };
    [key: string]: unknown;
}

/** A library entry from a loader JSON */
export interface LoaderLibrary {
    name: string;
    loader?: string;
    url?: string;
    rules?: LibraryRule[];
    natives?: Record<string, string>;
    downloads?: LibraryDownloads;
    [key: string]: unknown;
}

/** Loader installation result */
export interface LoaderResult {
    id?: string;
    error?: string;
    [key: string]: unknown;
}

/** Type alias for method returns that may be a result or error */
export type LoaderMethodResult = Record<string, unknown> & { error?: string };

// ========================
// Loader Downloader Types
// ========================

/** Configuration passed to the main Loader downloader */
export interface LoaderDownloaderConfig {
    type: LoaderType;
    version: string;
    build: string;
    config: {
        javaPath: string;
        minecraftJar: string;
        minecraftJson: string;
    };
}

/** Options for the Loader downloader */
export interface LoaderDownloaderOptions {
    path: string;
    loader: LoaderDownloaderConfig;
    downloadFileMultiple?: number;
}

// ========================
// Minecraft Version JSON Types
// ========================

/** Java version info within a Minecraft version JSON */
export interface JavaVersionInfo {
    component?: string;
    majorVersion?: number;
}

/** Asset index reference */
export interface AssetIndex {
    id: string;
    url: string;
    sha1?: string;
    size?: number;
    totalSize?: number;
}

/** Library rule for allow/disallow */
export interface LibraryRule {
    action: 'allow' | 'disallow';
    os?: {
        name?: string;
        version?: string;
    };
    features?: Record<string, boolean>;
}

/** Library download artifact */
export interface LibraryArtifact {
    sha1: string;
    size: number;
    path: string;
    url: string;
}

/** Library downloads section */
export interface LibraryDownloads {
    artifact?: LibraryArtifact;
    classifiers?: Record<string, LibraryArtifact>;
}

/** A library entry in a Minecraft version JSON */
export interface MinecraftLibrary {
    name: string;
    rules?: LibraryRule[];
    natives?: Record<string, string>;
    downloads?: LibraryDownloads;
    loader?: string;
    [key: string]: unknown;
}

/** Client download info */
export interface ClientDownload {
    sha1: string;
    size: number;
    url: string;
}

/** Logging configuration file */
export interface LoggingFile {
    id: string;
    sha1: string;
    size: number;
    url: string;
}

/** Logging configuration */
export interface LoggingConfig {
    client?: {
        argument: string;
        file: LoggingFile;
        type: string;
    };
}

/** The Minecraft version JSON structure */
export interface MinecraftVersionJSON {
    id: string;
    type: string;
    assets?: string;
    assetIndex?: AssetIndex;
    mainClass?: string;
    minecraftArguments?: string;
    javaVersion?: JavaVersionInfo;
    nativesList?: boolean;
    logging?: LoggingConfig;
    arguments?: {
        game?: Array<string | ArgumentRule>;
        jvm?: Array<string | ArgumentRule>;
        'default-user-jvm'?: Array<DefaultUserJVMArg>;
    };
    libraries: MinecraftLibrary[];
    downloads: {
        client: ClientDownload;
        [key: string]: ClientDownload;
    };
}

/** Argument rule (complex argument entry) */
export interface ArgumentRule {
    rules?: LibraryRule[];
    value?: string | string[];
}

/** Default user JVM argument entry */
export interface DefaultUserJVMArg {
    rules?: LibraryRule[];
    value?: string | string[];
}

// ========================
// Mojang Version Manifest
// ========================

/** A single version entry from the Mojang version manifest */
export interface VersionEntry {
    id: string;
    type: string;
    url: string;
    time: string;
    releaseTime: string;
}

/** The Mojang version manifest structure */
export interface MojangVersionManifest {
    latest: {
        release: string;
        snapshot: string;
    };
    versions: VersionEntry[];
}

/** Result of GetInfoVersion */
export interface GetInfoVersionResult {
    InfoVersion: VersionEntry;
    json: MinecraftVersionJSON;
    version: string;
}

/** Error from GetInfoVersion */
export interface GetInfoVersionError {
    error: true;
    message: string;
}

// ========================
// Download Types
// ========================

/** Represents a file to download */
export interface DownloadFile {
    sha1?: string;
    size?: number;
    path: string;
    type?: string;
    url?: string;
    content?: string;
    folder?: string;
    name?: string;
}

/** Options for downloading a single file */
export interface DownloadOptions {
    url: string;
    path: string;
    length?: number;
    folder: string;
    type?: string;
}

/** Asset item from the asset index */
export interface AssetItem {
    type: 'CFILE' | 'Assets';
    path: string;
    content?: string;
    sha1?: string;
    size?: number;
    url?: string;
}

/** Bundle item for checking/downloading */
export interface BundleItem {
    type?: string;
    path: string;
    folder?: string;
    content?: string;
    sha1?: string;
    size?: number;
    url?: string;
}

// ========================
// Java Types
// ========================

/** Java download options */
export interface JavaOptions {
    /**
     * Absolute path to Java binaries directory.
     * If set, expects Java to be already downloaded.
     */
    path?: string;
    /**
     * Java version number (e.g., 21).
     * If set, fetched from Azul API.
     * If undefined, fetched from Mojang.
     */
    version?: string;
    /**
     * Java image type: 'jdk', 'jre', 'testimage', 'debugimage', 'staticlibs', 'sources', 'sbom'.
     */
    type: string;
}

/** Result from Java download */
export interface JavaDownloadResult {
    files: JavaFileItem[];
    path: string;
    error?: boolean;
    message?: string;
}

/** A single Java file entry */
export interface JavaFileItem {
    path: string;
    executable?: boolean;
    sha1?: string;
    size?: number;
    url?: string;
    type?: string;
}

// ========================
// Screen / Memory Types
// ========================

/** Screen options */
export interface ScreenOptions {
    width?: number;
    height?: number;
    /** Should Minecraft be started in fullscreen mode? */
    fullscreen?: boolean;
}

/** Memory limits */
export interface MemoryOptions {
    /** Sets the `-Xms` JVM argument (initial memory). */
    min?: string;
    /** Sets the `-Xmx` JVM argument (max memory). */
    max?: string;
}

// ========================
// Launch Options
// ========================

/** Main launch options passed to the Launch class */
export interface LaunchOptions {
    /**
     * URL to the launcher backend.
     */
    url?: string | null;
    /**
     * Authenticator object from Mojang, Microsoft or AZauth.
     */
    authenticator: Authenticator;
    /** Connection timeout in milliseconds. */
    timeout?: number;
    /** Absolute path to Minecraft's root directory. */
    path: string;
    /** Minecraft version. */
    version: string;
    /**
     * Path to instance directory, relative to `path`.
     * Separates game files from game data.
     */
    instance?: string | null;
    /** Should Minecraft process be independent of launcher? */
    detached?: boolean;
    /** How many concurrent downloads can be in progress at once. */
    downloadFileMultiple?: number;
    /** Bypass offline mode for multiplayer. */
    bypassOffline?: boolean;
    /** Intel Macs: use dedicated GPU instead of integrated. */
    intelEnabledMac?: boolean;
    /** Ignore log4j configuration. */
    ignore_log4j?: boolean;
    /** Loader configuration. */
    loader: LoaderConfig;
    /** MCPatcher directory. Relative to `instance` or `path`. */
    mcp?: string | null;
    /** Should game files be verified each launch? */
    verify: boolean;
    /** Files to ignore from instance. */
    ignored: string[];
    /** Custom JVM arguments. */
    JVM_ARGS: string[];
    /** Custom game arguments. */
    GAME_ARGS: string[];
    /** Java options. */
    java: JavaOptions;
    /** Screen options. */
    screen: ScreenOptions;
    /** Memory limit options. */
    memory: MemoryOptions;
}

// ========================
// Launch Arguments Return Types
// ========================

/** Data returned by MinecraftArguments.GetArguments() */
export interface LaunchArguments {
    game: string[];
    jvm: string[];
    classpath: string[];
    mainClass?: string;
}

/** Data returned by MinecraftLoader.GetArguments() */
export interface LoaderArguments {
    game: string[];
    jvm: string[];
    mainClass?: string;
}

// ========================
// Status Server Types
// ========================

/** Server status response */
export interface ServerStatus {
    error: false;
    ms: number;
    version: string;
    playersConnect: number;
    playersMax: number;
}

/** Server status error */
export interface ServerStatusError {
    error: Error;
}

// ========================
// Forge Patcher Types
// ========================

/** Forge/NeoForge patcher processor */
export interface PatcherProcessor {
    jar: string;
    args: string[];
    classpath: string[];
    sides?: string[];
}

/** Forge/NeoForge patcher profile data entry */
export interface PatcherProfileData {
    client: string;
    [key: string]: string;
}

/** Forge/NeoForge patcher profile */
export interface PatcherProfile {
    data?: Record<string, PatcherProfileData>;
    processors?: PatcherProcessor[];
    libraries?: MinecraftLibrary[];
    path?: string;
}

/** Patcher config */
export interface PatcherConfig {
    java: string;
    minecraft: string;
    minecraftJson: string;
}

// ========================
// Forge/NeoForge Install Profile
// ========================

/** Forge install profile */
export interface ForgeInstallProfile {
    libraries?: MinecraftLibrary[];
    processors?: PatcherProcessor[];
    data?: Record<string, PatcherProfileData>;
    path?: string;
    filePath?: string;
    json?: string;
    [key: string]: unknown;
}

/** Forge extracted profile result */
export interface ForgeExtractedProfile {
    install?: ForgeInstallProfile;
    version?: LoaderJSON;
    error?: { message: string };
}

// ========================
// Fabric/Quilt Types
// ========================

/** Fabric/Quilt/LegacyFabric metadata */
export interface FabricMetaData {
    game: Array<{ version: string; stable: boolean }>;
    loader: Array<{ version: string; stable: boolean }>;
}

/** Fabric/Quilt library */
export interface FabricLibrary {
    name: string;
    url: string;
    rules?: Array<Record<string, unknown>>;
}

/** Fabric/Quilt JSON */
export interface FabricJSON {
    id?: string;
    libraries: FabricLibrary[];
    mainClass?: string;
    arguments?: {
        game?: string[];
        jvm?: string[];
    };
    error?: string;
    [key: string]: unknown;
}

/** Fabric/Quilt loader data endpoints */
export interface FabricLoaderData {
    metaData: string;
    json: string;
}

// ========================
// Forge loader data endpoints
// ========================

export interface ForgeLoaderData {
    metaData: string;
    meta: string;
    promotions: string;
    install: string;
    universal: string;
    client: string;
}

/** NeoForge loader data endpoints */
export interface NeoForgeLoaderData {
    legacyMetaData: string;
    metaData: string;
    legacyInstall: string;
    install: string;
}

// ========================
// Custom Asset (from backend URL)
// ========================

/** Custom asset item from a backend URL */
export interface CustomAssetItem {
    path: string;
    hash: string;
    size: number;
    url: string;
}

// ========================
// Utility Types
// ========================

/** Library path info returned by getPathLibraries() */
export interface LibraryPathInfo {
    path: string;
    name: string;
    version: string;
}

/** Zip entry */
export interface ZipEntry {
    entryName: string;
    isDirectory: boolean;
    getData: () => Buffer;
}

/** Archive extracted file */
export interface ArchiveEntry {
    name: string;
    data: Buffer;
    isDirectory: boolean;
}

// ========================
// Event Payload Types
// ========================

/** Progress event data */
export interface ProgressEvent {
    progress: number;
    size: number;
    element: string;
}

/** Speed event data (bytes per second) */
export type SpeedEvent = number;

/** Estimated time event data (seconds remaining) */
export type EstimatedEvent = number;

// ========================
// OS Mappings
// ========================

/** Maps Node.js platforms to Mojang's OS naming */
export const MOJANG_OS_MAP: Record<string, string> = {
    win32: 'windows',
    darwin: 'osx',
    linux: 'linux'
};

/** Maps Node.js arch to Mojang's arch replacements */
export const MOJANG_ARCH_MAP: Record<string, string> = {
    x32: '32',
    x64: '64',
    arm: '32',
    arm64: '64'
};
