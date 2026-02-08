import fs from 'fs';
import zlib from 'zlib';
import type { ZipEntry } from '../types.js';

export default class Unzipper {
    private entries: ZipEntry[] = [];

    constructor(zipFilePath: string) {
        const fileBuffer = fs.readFileSync(zipFilePath);

        const eocdSig = Buffer.from([0x50, 0x4B, 0x05, 0x06]);
        const maxCommentLength = 0xFFFF;
        const scanStart = Math.max(0, fileBuffer.length - (maxCommentLength + 22));

        let eocdPos = -1;
        for (let i = fileBuffer.length - 22; i >= scanStart; i--) {
            if (
                fileBuffer[i] === 0x50 &&
                fileBuffer[i + 1] === 0x4B &&
                fileBuffer[i + 2] === 0x05 &&
                fileBuffer[i + 3] === 0x06
            ) {
                eocdPos = i;
                break;
            }
        }

        if (eocdPos !== -1) {
            const cdOffset = fileBuffer.readUInt32LE(eocdPos + 16);
            const cdSize = fileBuffer.readUInt32LE(eocdPos + 12);
            const cdEnd = cdOffset + cdSize;

            let cdCursor = cdOffset;

            while (cdCursor < cdEnd) {
                if (cdCursor + 46 > fileBuffer.length) break; // sécurité

                if (fileBuffer.readUInt32LE(cdCursor) !== 0x02014b50) break;

                const compressionMethod = fileBuffer.readUInt16LE(cdCursor + 10);
                const compressedSize = fileBuffer.readUInt32LE(cdCursor + 20);
                const uncompressedSize = fileBuffer.readUInt32LE(cdCursor + 24);
                const fileNameLength = fileBuffer.readUInt16LE(cdCursor + 28);
                const extraFieldLength = fileBuffer.readUInt16LE(cdCursor + 30);
                const fileCommentLength = fileBuffer.readUInt16LE(cdCursor + 32);
                const relativeOffset = fileBuffer.readUInt32LE(cdCursor + 42);

                const fileName = fileBuffer.toString(
                    'utf-8',
                    cdCursor + 46,
                    cdCursor + 46 + fileNameLength
                );

                const headerOffset = relativeOffset;
                // Sécurité sur l'offset du header
                if (headerOffset + 30 > fileBuffer.length) {
                    cdCursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
                    continue;
                }
                if (fileBuffer.readUInt32LE(headerOffset) !== 0x04034b50) {
                    cdCursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
                    continue;
                }

                const lfFileNameLength = fileBuffer.readUInt16LE(headerOffset + 26);
                const lfExtraFieldLength = fileBuffer.readUInt16LE(headerOffset + 28);
                const dataStart = headerOffset + 30 + lfFileNameLength + lfExtraFieldLength;
                const dataEnd = dataStart + compressedSize;

                // Sécurité: ne pas dépasser la taille du buffer
                if (dataEnd > fileBuffer.length) {
                    cdCursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
                    continue;
                }

                const compressedData = fileBuffer.slice(dataStart, dataEnd);

                this.entries.push({
                    entryName: fileName,
                    isDirectory: fileName.endsWith('/'),
                    getData: () => {
                        if (compressionMethod === 8) {
                            return zlib.inflateRawSync(compressedData);
                        } else if (compressionMethod === 0) {
                            return compressedData;
                        } else {
                            throw new Error(`Unsupported compression method: ${compressionMethod}`);
                        }
                    }
                });

                cdCursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
            }
        } else {
            let currentOffset = 0;
            while (currentOffset < fileBuffer.length - 4) {
                const signaturePos = fileBuffer.indexOf(
                    Buffer.from([0x50, 0x4B, 0x03, 0x04]),
                    currentOffset
                );
                if (signaturePos === -1) break;

                const headerOffset = signaturePos;
                if (headerOffset + 30 > fileBuffer.length) break;

                const compressionMethod = fileBuffer.readUInt16LE(headerOffset + 8);
                const compressedSize = fileBuffer.readUInt32LE(headerOffset + 18);
                const uncompressedSize = fileBuffer.readUInt32LE(headerOffset + 22);
                const fileNameLength = fileBuffer.readUInt16LE(headerOffset + 26);
                const extraFieldLength = fileBuffer.readUInt16LE(headerOffset + 28);

                const fileNameStart = headerOffset + 30;
                const fileNameEnd = fileNameStart + fileNameLength;
                if (fileNameEnd > fileBuffer.length) break;

                const fileName = fileBuffer.toString(
                    'utf-8',
                    fileNameStart,
                    fileNameEnd
                );

                const dataStart = fileNameEnd + extraFieldLength;
                const dataEnd = dataStart + compressedSize;

                if (dataEnd > fileBuffer.length) {
                    currentOffset = dataEnd;
                    continue;
                }

                const compressedData = fileBuffer.slice(dataStart, dataEnd);

                this.entries.push({
                    entryName: fileName,
                    isDirectory: fileName.endsWith('/'),
                    getData: () => {
                        if (compressionMethod === 8) {
                            return zlib.inflateRawSync(compressedData);
                        } else if (compressionMethod === 0) {
                            return compressedData;
                        } else {
                            throw new Error(`Unsupported compression method: ${compressionMethod}`);
                        }
                    }
                });

                currentOffset = dataEnd;
            }
        }
    }

    getEntries(): ZipEntry[] {
        return this.entries;
    }
}
