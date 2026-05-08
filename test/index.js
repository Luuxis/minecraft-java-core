const { Launch, Microsoft } = require('minecraft-java-core');
const fs = require('fs');

const ACCOUNT_FILE = './account.json';
const API_URL = 'http://luuxcraft.fr/api/user/d7439d52-b6b9-4e9e-a920-2932e8afb2ee/instances';
const INSTANCE_NAME = 'BestiMon';
const DOWNLOAD_SIMULTANEOUS = 30;
const MINECRAFT_PATH = './minecraft';
const MEMORY_CONFIG = { min: '14G', max: '16G' };


async function loadOrAuthenticateAccount() {
    const microsoft = new Microsoft();

    if (!fs.existsSync(ACCOUNT_FILE)) {
        const account = await microsoft.getAuth();
        fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 4));
        return account;
    }

    const account = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'));

    if (!account.refresh_token) {
        const newAccount = await microsoft.getAuth();
        fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(newAccount, null, 4));
        return newAccount;
    }

    const refreshedAccount = await microsoft.refresh(account);
    if (refreshedAccount.error) {
        throw new Error(`Erreur d'authentification: ${refreshedAccount.error}`);
    }

    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(refreshedAccount, null, 4));
    return refreshedAccount;
}

async function fetchInstanceData() {
    const response = await fetch(API_URL);

    if (!response.ok) {
        throw new Error(`Erreur API: ${response.status} ${response.statusText}`);
    }

    const instances = await response.json();
    const instanceData = Object.values(instances).find(
        i => i.name.toLowerCase() === INSTANCE_NAME.toLowerCase()
    );

    if (!instanceData) {
        throw new Error(`Instance "${INSTANCE_NAME}" introuvable`);
    }

    return instanceData;
}

function buildLaunchOptions(instanceData, account) {
    const loaderType = instanceData.loader?.loader_type.toLowerCase() || instanceData.loadder.loadder_type.toLowerCase();

    return {
        url: instanceData.url,
        path: MINECRAFT_PATH,
        authenticator: account,
        version: instanceData.loader?.minecraft_version || instanceData.loadder.minecraft_version,
        intelEnabledMac: true,
        instance: instanceData.name,
        ignore_log4j: true,
        ignored: instanceData.ignored,
        downloadFileMultiple: DOWNLOAD_SIMULTANEOUS,
        loader: {
            type: loaderType,
            build: instanceData.loader?.loader_version || instanceData.loadder.loadder_version,
            enable: loaderType !== 'none',
            path: './'
        },
        JVM_ARGS: [],
        memory: MEMORY_CONFIG,
        java: {
            // version: 8
        }
    };
}

function setupLauncherListeners(launcher) {
    launcher.on('progress', (progress, size) => {
        const percentage = ((progress / size) * 100).toFixed(2);
        console.log(`[DL] ${percentage} %`);
    });

    launcher.on('patch', patch => process.stdout.write(patch));
    launcher.on('data', line => process.stdout.write(line));
    launcher.on('error', err => console.error('[ERROR]', err));
}

async function main() {
    try {
        console.log('🔐 Authentification en cours...');
        const account = await loadOrAuthenticateAccount();

        console.log('📡 Récupération des données de l\'instance...');
        const instanceData = await fetchInstanceData();

        console.log(`🎮 Lancement de ${instanceData.name}...`);
        const launcher = new Launch();
        const options = buildLaunchOptions(instanceData, account);

        setupLauncherListeners(launcher);
        launcher.Launch(options);

    } catch (error) {
        console.error('❌ Erreur fatale:', error.message);
        process.exit(1);
    }
}

main();
