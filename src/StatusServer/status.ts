/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import net from 'net'
import createBuffer from './buffer.js';

interface ServerStatus {
    error: boolean;
    ms: number;
    version: string;
    playersConnect: number;
    playersMax: number;
}

function ping(server: string, port: number, callback: (err: Error | null, result: ServerStatus | null) => void, timeout: number, protocol: number | string = '') {
    let start = Date.now();
    let socket = net.connect({
        port: port,
        host: server
    }, () => {
        let handshakeBuffer = new (createBuffer as any)();

        handshakeBuffer.writeletInt(0);
        handshakeBuffer.writeletInt(protocol);
        handshakeBuffer.writeString(server);
        handshakeBuffer.writeUShort(port);
        handshakeBuffer.writeletInt(1);

        writePCBuffer(socket, handshakeBuffer);

        let setModeBuffer = new (createBuffer as any)();

        setModeBuffer.writeletInt(0);

        writePCBuffer(socket, setModeBuffer);
    });

    socket.setTimeout(timeout, () => {
        if (callback) callback(new Error("Socket timed out when connecting to " + server + ":" + port), null);
        socket.destroy();
    });

    let readingBuffer = Buffer.alloc(0);

    socket.on('data', data => {
        readingBuffer = Buffer.concat([readingBuffer, data]);

        let buffer = new (createBuffer as any)(readingBuffer);
        let length: number;

        try {
            length = buffer.readletInt();
        } catch (err) {
            return;
        }

        if (readingBuffer.length < length - buffer.offset()) return;

        buffer.readletInt();

        try {
            let end = Date.now()
            let json = JSON.parse(buffer.readString());
            callback(null, {
                error: false,
                ms: Math.round(end - start),
                version: json.version.name,
                playersConnect: json.players.online,
                playersMax: json.players.max
            });
        } catch (err) {
            return callback(err, null);
        }

        socket.destroy();
    });

    socket.once('error', err => {
        if (callback) callback(err, null);
        socket.destroy();
    });
};

function writePCBuffer(client: net.Socket, buffer: { buffer: () => Buffer }) {
    let length = new (createBuffer as any)();
    length.writeletInt(buffer.buffer().length);
    client.write(Buffer.concat([length.buffer(), buffer.buffer()]));
}

export default class status {
    ip: string
    port: number
    constructor(ip = '0.0.0.0', port = 25565) {
        this.ip = ip
        this.port = port
    }

    async getStatus(): Promise<ServerStatus> {
        return await new Promise((resolve, reject) => {
            ping(this.ip, this.port, (err: Error | null, res: ServerStatus | null) => {
                if (err) return reject({ error: err });
                return resolve(res!);
            }, 3000);
        })
    }
}