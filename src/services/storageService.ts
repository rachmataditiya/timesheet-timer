import * as vscode from 'vscode';
import { OdooCredentials } from '../odoo/client';

const STORAGE_KEY_PREFIX = 'odoo-timesheet-timer';
const CREDENTIALS_KEY = `${STORAGE_KEY_PREFIX}:credentials`;
const SERVER_URL_KEY = `${STORAGE_KEY_PREFIX}:serverUrl`;
const DATABASE_KEY = `${STORAGE_KEY_PREFIX}:database`;
const USERNAME_KEY = `${STORAGE_KEY_PREFIX}:username`;
const PASSWORD_KEY = `${STORAGE_KEY_PREFIX}:password`;

export class StorageService {
	private context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	async getServerUrl(): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('odoo');
		const serverUrl = config.get<string>('serverUrl', '');
		if (serverUrl) {
			return serverUrl;
		}
		return this.context.secrets.get(SERVER_URL_KEY);
	}

	async getDatabase(): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('odoo');
		const database = config.get<string>('database', '');
		if (database) {
			return database;
		}
		return this.context.secrets.get(DATABASE_KEY);
	}

	async getCredentials(): Promise<OdooCredentials | null> {
		const serverUrl = await this.getServerUrl();
		const database = await this.getDatabase();
		const username = await this.context.secrets.get(USERNAME_KEY);
		const password = await this.context.secrets.get(PASSWORD_KEY);

		if (!serverUrl || !database || !username || !password) {
			return null;
		}

		return {
			url: serverUrl,
			database: database,
			username: username,
			password: password,
		};
	}

	async saveCredentials(credentials: OdooCredentials): Promise<void> {
		// Store in secrets
		await this.context.secrets.store(SERVER_URL_KEY, credentials.url);
		await this.context.secrets.store(DATABASE_KEY, credentials.database);
		await this.context.secrets.store(USERNAME_KEY, credentials.username);
		await this.context.secrets.store(PASSWORD_KEY, credentials.password);
	}

	async clearCredentials(): Promise<void> {
		await this.context.secrets.delete(SERVER_URL_KEY);
		await this.context.secrets.delete(DATABASE_KEY);
		await this.context.secrets.delete(USERNAME_KEY);
		await this.context.secrets.delete(PASSWORD_KEY);
	}

	async hasCredentials(): Promise<boolean> {
		const credentials = await this.getCredentials();
		return credentials !== null;
	}
}

