import { OdooClient } from './client';

export interface TimesheetEntry {
	id?: number;
	name: string;
	date: string; // YYYY-MM-DD
	unit_amount: number; // Hours
	project_id?: number;
	task_id?: number;
	employee_id?: number;
	account_id?: number;
	user_id?: number;
}

export interface Project {
	id: number;
	name: string;
}

export interface Task {
	id: number;
	name: string;
	project_id: number;
}

export class OdooTimesheet {
	private client: OdooClient;

	constructor(client: OdooClient) {
		this.client = client;
	}

	async getProjects(limit: number = 100): Promise<Project[]> {
		try {
			const projects = await this.client.search(
				'project.project',
				[['allow_timesheets', '=', true]],
				['id', 'name'],
				limit
			);
			return projects.map((p: any) => ({
				id: p.id,
				name: p.name,
			}));
		} catch (error) {
			console.error('Failed to fetch projects:', error);
			return [];
		}
	}

	async getTasks(projectId?: number, limit: number = 100): Promise<Task[]> {
		try {
			const domain: any[] = [];
			if (projectId) {
				domain.push(['project_id', '=', projectId]);
			}
			domain.push(['allow_timesheets', '=', true]);
			
			const tasks = await this.client.search(
				'project.task',
				domain,
				['id', 'name', 'project_id'],
				limit
			);
			return tasks.map((t: any) => ({
				id: t.id,
				name: t.name,
				project_id: t.project_id?.[0] || 0,
			}));
		} catch (error) {
			console.error('Failed to fetch tasks:', error);
			return [];
		}
	}

	async createTimesheetEntry(entry: TimesheetEntry): Promise<number> {
		const values: any = {
			name: entry.name,
			date: entry.date,
			unit_amount: entry.unit_amount,
		};

		if (entry.project_id) {
			values.project_id = entry.project_id;
		}
		if (entry.task_id) {
			values.task_id = entry.task_id;
		}
		if (entry.employee_id) {
			values.employee_id = entry.employee_id;
		}
		if (entry.account_id) {
			values.account_id = entry.account_id;
		}
		if (entry.user_id) {
			values.user_id = entry.user_id;
		}

		return this.client.create('account.analytic.line', values);
	}

	async updateTimesheetEntry(id: number, values: Partial<TimesheetEntry>): Promise<boolean> {
		const updateValues: any = {};
		
		if (values.name !== undefined) {
			updateValues.name = values.name;
		}
		if (values.date !== undefined) {
			updateValues.date = values.date;
		}
		if (values.unit_amount !== undefined) {
			updateValues.unit_amount = values.unit_amount;
		}
		if (values.project_id !== undefined) {
			updateValues.project_id = values.project_id;
		}
		if (values.task_id !== undefined) {
			updateValues.task_id = values.task_id;
		}

		return this.client.update('account.analytic.line', [id], updateValues);
	}

	async getTimesheetEntry(id: number): Promise<TimesheetEntry | null> {
		const entries = await this.client.read('account.analytic.line', [id], [
			'name',
			'date',
			'unit_amount',
			'project_id',
			'task_id',
			'employee_id',
			'account_id',
			'user_id',
		]);

		if (entries.length === 0) {
			return null;
		}

		return this.mapToTimesheetEntry(entries[0]);
	}

	async listTimesheetEntries(domain: any[] = [], limit: number = 20): Promise<TimesheetEntry[]> {
		const entries = await this.client.search('account.analytic.line', domain, [
			'name',
			'date',
			'unit_amount',
			'project_id',
			'task_id',
			'employee_id',
			'account_id',
			'user_id',
		], limit);

		return entries.map((entry: any) => this.mapToTimesheetEntry(entry));
	}

	async getTodayTimesheetEntries(userId?: number): Promise<TimesheetEntry[]> {
		const today = new Date().toISOString().split('T')[0];
		const domain: any[] = [['date', '=', today]];
		
		if (userId) {
			domain.push(['user_id', '=', userId]);
		}

		return this.listTimesheetEntries(domain);
	}

	async getRunningTimer(): Promise<any> {
		// Use the get_running_timer method from account.analytic.line model
		// This returns the running timer information including timesheet ID, start time, etc.
		const result = await this.client.executeKw(
			'account.analytic.line',
			'get_running_timer',
			[],
			{}
		);
		
		if (!result || Object.keys(result).length === 0) {
			return null;
		}

		// Get the full timesheet entry details
		if (result.id) {
			const entry = await this.getTimesheetEntry(result.id);
			if (entry) {
				return {
					...entry,
					running_seconds: result.start || 0,
					project_id: result.project_id,
					task_id: result.task_id,
				};
			}
		}

		return null;
	}

	async startTimer(timesheetId: number): Promise<boolean> {
		// Call action_timer_start on the timesheet entry
		return this.client.executeKw(
			'account.analytic.line',
			'action_timer_start',
			[[timesheetId]],
			{}
		);
	}

	async stopTimer(timesheetId: number, tryToMatch: boolean = false): Promise<boolean> {
		// Call action_timer_stop on the timesheet entry
		return this.client.executeKw(
			'account.analytic.line',
			'action_timer_stop',
			[[timesheetId]],
			{ try_to_match: tryToMatch }
		);
	}

	async deleteTimesheetEntry(id: number): Promise<boolean> {
		return this.client.unlink('account.analytic.line', [id]);
	}

	private mapToTimesheetEntry(entry: any): TimesheetEntry {
		return {
			id: entry.id,
			name: entry.name || '',
			date: entry.date || new Date().toISOString().split('T')[0],
			unit_amount: entry.unit_amount || 0,
			project_id: entry.project_id?.[0],
			task_id: entry.task_id?.[0],
			employee_id: entry.employee_id?.[0],
			account_id: entry.account_id?.[0],
			user_id: entry.user_id?.[0],
		};
	}
}
