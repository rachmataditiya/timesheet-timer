import * as vscode from 'vscode';
import { OdooClient, OdooCredentials } from './client';
import { StorageService } from '../services/storageService';

export class OdooAuth {
	private client: OdooClient;
	private storage: StorageService;

	constructor(client: OdooClient, storage: StorageService) {
		this.client = client;
		this.storage = storage;
	}

	async login(): Promise<boolean> {
		try {
			// Check if credentials exist
			let credentials = await this.storage.getCredentials();

			// If no credentials, prompt for login
			if (!credentials) {
				credentials = await this.promptForCredentials();
				if (!credentials) {
					return false;
				}
				await this.storage.saveCredentials(credentials);
			}

			// Try to authenticate
			this.client.setCredentials(credentials);
			await this.client.authenticate();

			vscode.window.showInformationMessage('Successfully logged in to Odoo');
			return true;
		} catch (error: any) {
			const errorMessage = error.message || 'Login failed';
			vscode.window.showErrorMessage(`Failed to login: ${errorMessage}`);
			
			// Clear invalid credentials
			await this.storage.clearCredentials();
			return false;
		}
	}

	private async promptForCredentials(): Promise<OdooCredentials | null> {
		// Get server URL
		const serverUrl = await vscode.window.showInputBox({
			prompt: 'Enter Odoo server URL',
			placeHolder: 'https://odoo.example.com',
			value: await this.storage.getServerUrl() || '',
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Server URL is required';
				}
				try {
					new URL(value);
				} catch {
					return 'Invalid URL format';
				}
				return null;
			},
		});

		if (!serverUrl) {
			return null;
		}

		// Get database
		const database = await vscode.window.showInputBox({
			prompt: 'Enter database name',
			placeHolder: 'odoo',
			value: await this.storage.getDatabase() || '',
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Database name is required';
				}
				return null;
			},
		});

		if (!database) {
			return null;
		}

		// Get username
		const username = await vscode.window.showInputBox({
			prompt: 'Enter username',
			placeHolder: 'admin',
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Username is required';
				}
				return null;
			},
		});

		if (!username) {
			return null;
		}

		// Get password
		const password = await vscode.window.showInputBox({
			prompt: 'Enter password',
			password: true,
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Password is required';
				}
				return null;
			},
		});

		if (!password) {
			return null;
		}

		return {
			url: serverUrl.trim(),
			database: database.trim(),
			username: username.trim(),
			password: password,
		};
	}

	async ensureAuthenticated(): Promise<boolean> {
		if (this.client.isAuthenticated()) {
			return true;
		}

		return await this.login();
	}

	async logout(): Promise<void> {
		this.client.logout();
		await this.storage.clearCredentials();
		vscode.window.showInformationMessage('Logged out from Odoo');
	}
}

