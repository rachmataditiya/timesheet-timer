import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';

export interface OdooCredentials {
	url: string;
	database: string;
	username: string;
	password: string;
}

export interface OdooSession {
	uid: number;
	sessionId: string;
	context: any;
}

export class OdooClient {
	private credentials: OdooCredentials | null = null;
	private session: OdooSession | null = null;
	private axiosInstance: AxiosInstance | null = null;

	constructor() {}

	setCredentials(credentials: OdooCredentials): void {
		this.credentials = credentials;
		this.axiosInstance = axios.create({
			baseURL: credentials.url,
			timeout: 30000,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}

	async authenticate(): Promise<OdooSession> {
		if (!this.credentials || !this.axiosInstance) {
			throw new Error('Credentials not set. Please configure Odoo connection.');
		}

		try {
			const response = await this.axiosInstance.post('/web/session/authenticate', {
				jsonrpc: '2.0',
				params: {
					db: this.credentials.database,
					login: this.credentials.username,
					password: this.credentials.password,
					base_location: this.credentials.url,
				},
			});

			if (response.data.error) {
				throw new Error(response.data.error.data?.message || 'Authentication failed');
			}

			const result = response.data.result;
			if (!result || !result.uid) {
				throw new Error('Invalid authentication response');
			}

			this.session = {
				uid: result.uid,
				sessionId: result.session_id || '',
				context: result.user_context || {},
			};

			// Set session cookie for subsequent requests
			if (response.headers['set-cookie']) {
				this.axiosInstance.defaults.headers.common['Cookie'] = response.headers['set-cookie'].join('; ');
			}

			return this.session;
		} catch (error: any) {
			if (axios.isAxiosError(error)) {
				if (error.response?.status === 401 || error.response?.status === 403) {
					throw new Error('Invalid credentials');
				}
				throw new Error(`Connection error: ${error.message}`);
			}
			throw error;
		}
	}

	async executeKw(
		model: string,
		method: string,
		args: any[] = [],
		kwargs: any = {}
	): Promise<any> {
		if (!this.session || !this.axiosInstance) {
			throw new Error('Not authenticated. Please login first.');
		}

		try {
			const response = await this.axiosInstance.post('/web/dataset/call_kw', {
				jsonrpc: '2.0',
				method: 'call',
				params: {
					model: model,
					method: method,
					args: args,
					kwargs: kwargs,
					context: this.session.context,
				},
				id: Math.floor(Math.random() * 1000000),
			});

			if (response.data.error) {
				throw new Error(response.data.error.data?.message || 'API call failed');
			}

			return response.data.result;
		} catch (error: any) {
			if (axios.isAxiosError(error)) {
				if (error.response?.status === 401 || error.response?.status === 403) {
					// Session expired, try to re-authenticate
					this.session = null;
					throw new Error('Session expired. Please login again.');
				}
				throw new Error(`API error: ${error.message}`);
			}
			throw error;
		}
	}

	async search(model: string, domain: any[], fields?: string[], limit?: number): Promise<any[]> {
		const kwargs: any = {};
		if (fields) {
			kwargs.fields = fields;
		}
		if (limit) {
			kwargs.limit = limit;
		}
		return this.executeKw(model, 'search_read', [domain], kwargs);
	}

	async create(model: string, values: any): Promise<number> {
		return this.executeKw(model, 'create', [values]);
	}

	async update(model: string, ids: number[], values: any): Promise<boolean> {
		return this.executeKw(model, 'write', [ids, values]);
	}

	async unlink(model: string, ids: number[]): Promise<boolean> {
		return this.executeKw(model, 'unlink', [ids]);
	}

	async read(model: string, ids: number[], fields?: string[]): Promise<any[]> {
		const kwargs: any = {};
		if (fields) {
			kwargs.fields = fields;
		}
		return this.executeKw(model, 'read', [ids], kwargs);
	}

	isAuthenticated(): boolean {
		return this.session !== null;
	}

	getSession(): OdooSession | null {
		return this.session;
	}

	logout(): void {
		this.session = null;
		this.credentials = null;
		this.axiosInstance = null;
	}
}

