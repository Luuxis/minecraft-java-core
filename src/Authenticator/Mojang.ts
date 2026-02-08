/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import crypto from 'crypto';
import type { MojangAuthResponse } from '../types.js';

let api_url = 'https://authserver.mojang.com';

interface MojangApiResponse {
	accessToken?: string;
	clientToken?: string;
	selectedProfile?: {
		id: string;
		name: string;
	};
	error?: string;
	errorMessage?: string;
}

async function login(username: string, password?: string): Promise<MojangAuthResponse> {
	const UUID = crypto.randomBytes(16).toString('hex');
	if (!password) {
		return {
			access_token: UUID,
			client_token: UUID,
			uuid: UUID,
			name: username,
			user_properties: '{}',
			meta: {
				online: false,
				type: 'Mojang'
			}
		};
	}

	const message: MojangApiResponse = await fetch(`${api_url}/authenticate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			agent: {
				name: "Minecraft",
				version: 1
			},
			username,
			password,
			clientToken: UUID,
			requestUser: true
		})
	}).then(res => res.json());

	if (message.error) {
		return {
			access_token: '',
			client_token: '',
			uuid: '',
			name: '',
			user_properties: '{}',
			meta: { online: false, type: 'Mojang' },
			error: message.error,
			errorMessage: message.errorMessage
		};
	}

	return {
		access_token: message.accessToken!,
		client_token: message.clientToken!,
		uuid: message.selectedProfile!.id,
		name: message.selectedProfile!.name,
		user_properties: '{}',
		meta: {
			online: true,
			type: 'Mojang'
		}
	};
}

async function refresh(acc: MojangAuthResponse): Promise<MojangAuthResponse> {
	const message: MojangApiResponse = await fetch(`${api_url}/refresh`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			accessToken: acc.access_token,
			clientToken: acc.client_token,
			requestUser: true
		})
	}).then(res => res.json());

	if (message.error) {
		return {
			access_token: '',
			client_token: '',
			uuid: '',
			name: '',
			user_properties: '{}',
			meta: { online: false, type: 'Mojang' },
			error: message.error,
			errorMessage: message.errorMessage
		};
	}

	return {
		access_token: message.accessToken!,
		client_token: message.clientToken!,
		uuid: message.selectedProfile!.id,
		name: message.selectedProfile!.name,
		user_properties: '{}',
		meta: {
			online: true,
			type: 'Mojang'
		}
	};
}

async function validate(acc: MojangAuthResponse): Promise<boolean> {
	const message = await fetch(`${api_url}/validate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			accessToken: acc.access_token,
			clientToken: acc.client_token,
		})
	});

	return message.status === 204;
}

async function signout(acc: MojangAuthResponse): Promise<boolean> {
	const message = await fetch(`${api_url}/invalidate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			accessToken: acc.access_token,
			clientToken: acc.client_token,
		})
	}).then(res => res.text());

	return message === "";
}

function ChangeAuthApi(url: string): void {
	api_url = url;
}

export {
	login,
	refresh,
	validate,
	signout,
	ChangeAuthApi
};