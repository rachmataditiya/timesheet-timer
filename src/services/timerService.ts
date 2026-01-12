import * as vscode from 'vscode';
import { OdooTimesheet, TimesheetEntry } from '../odoo/timesheet';
import { OdooClient } from '../odoo/client';

export interface TimerState {
	isRunning: boolean;
	startTime: Date | null;
	entryId: number | null;
	entry: TimesheetEntry | null;
}

export class TimerService {
	private state: TimerState;
	private timesheet: OdooTimesheet;
	private client: OdooClient;
	private updateCallbacks: Array<(state: TimerState) => void> = [];
	private intervalId: NodeJS.Timeout | null = null;
	private context: vscode.ExtensionContext | null = null;

	constructor(timesheet: OdooTimesheet, client: OdooClient, context?: vscode.ExtensionContext) {
		this.timesheet = timesheet;
		this.client = client;
		this.context = context || null;
		this.state = {
			isRunning: false,
			startTime: null,
			entryId: null,
			entry: null,
		};
	}

	onStateUpdate(callback: (state: TimerState) => void): void {
		this.updateCallbacks.push(callback);
	}

	private notifyStateUpdate(): void {
		this.updateCallbacks.forEach(callback => callback(this.state));
	}

	async startTimer(name: string, projectId?: number, taskId?: number): Promise<boolean> {
		if (this.state.isRunning) {
			vscode.window.showWarningMessage('Timer is already running');
			return false;
		}

		try {
			const today = new Date().toISOString().split('T')[0];
			
			// Get current user ID from session
			const session = this.client.getSession();
			if (!session) {
				throw new Error('Not authenticated');
			}

			// Create a timesheet entry (unit_amount can be 0, will be updated when stopped)
			const entry: TimesheetEntry = {
				name: name,
				date: today,
				unit_amount: 0,
				project_id: projectId,
				task_id: taskId,
				user_id: session.uid,
			};

			const entryId = await this.timesheet.createTimesheetEntry(entry);
			
			// Start the timer using Odoo's action_timer_start method
			await this.timesheet.startTimer(entryId);

			this.state = {
				isRunning: true,
				startTime: new Date(),
				entryId: entryId,
				entry: { ...entry, id: entryId },
			};

			// Save timer state to workspace storage
			this.saveState();

			this.startUpdateInterval();
			this.notifyStateUpdate();

			return true;
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to start timer: ${error.message}`);
			return false;
		}
	}

	async stopTimer(): Promise<boolean> {
		if (!this.state.isRunning || !this.state.entryId) {
			vscode.window.showWarningMessage('No timer is running');
			return false;
		}

		try {
			// Stop the timer using Odoo's action_timer_stop method
			// This will automatically calculate and update the unit_amount
			await this.timesheet.stopTimer(this.state.entryId, false);

		// Refresh the entry to get the updated unit_amount
		// Note: Odoo applies minimum duration and rounding rules, so the saved time
		// might be different from the actual elapsed time if it's below the minimum
		const updatedEntry = await this.timesheet.getTimesheetEntry(this.state.entryId);
		const duration = updatedEntry?.unit_amount || 0;
		const actualElapsed = this.getElapsedHours();

		const entryName = this.state.entry?.name || 'Timer';
		let message = `Timer stopped: ${entryName} (${duration.toFixed(2)} hours)`;
		if (duration > 0 && actualElapsed > 0 && Math.abs(duration - actualElapsed) > 0.1) {
			// Show warning if there's significant difference (likely due to Odoo minimum duration)
			message += `\nNote: Odoo minimum duration applied (actual: ${actualElapsed.toFixed(2)}h)`;
		}
		vscode.window.showInformationMessage(message);

			this.state = {
				isRunning: false,
				startTime: null,
				entryId: null,
				entry: null,
			};

			// Clear saved timer state
			this.clearState();

			this.stopUpdateInterval();
			this.notifyStateUpdate();

			return true;
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to stop timer: ${error.message}`);
			return false;
		}
	}

	async refreshState(): Promise<void> {
		try {
			// Always stop interval first to prevent duplicates
			this.stopUpdateInterval();
			
			// Always check for running timer from Odoo
			const runningTimer = await this.timesheet.getRunningTimer();
			
			if (runningTimer && runningTimer.id) {
				// Calculate start time from running_seconds
				const runningSeconds = runningTimer.running_seconds || 0;
				const currentSeconds = runningTimer.unit_amount ? runningTimer.unit_amount * 3600 : 0;
				const elapsedSeconds = runningSeconds - currentSeconds;
				const startTime = new Date(Date.now() - elapsedSeconds * 1000);

				this.state = {
					isRunning: true,
					startTime: startTime,
					entryId: runningTimer.id,
					entry: runningTimer,
				};
				// Save state when refreshed
				this.saveState();
				// Start interval after state is set
				this.startUpdateInterval();
				// Notify immediately
				this.notifyStateUpdate();
			} else {
				// No running timer, clear state
				if (this.state.isRunning) {
					this.state = {
						isRunning: false,
						startTime: null,
						entryId: null,
						entry: null,
					};
					// Clear saved state
					this.clearState();
					this.stopUpdateInterval();
					this.notifyStateUpdate();
				}
			}
		} catch (error: any) {
			console.error('Failed to refresh timer state:', error);
			// Ensure interval is stopped on error
			this.stopUpdateInterval();
		}
	}

	getState(): TimerState {
		return { ...this.state };
	}

	getElapsedHours(): number {
		if (!this.state.isRunning || !this.state.startTime) {
			return 0;
		}

		const elapsedMs = Date.now() - this.state.startTime.getTime();
		return elapsedMs / (1000 * 60 * 60); // Convert to hours
	}

	getElapsedTimeFormatted(): string {
		const hours = this.getElapsedHours();
		const h = Math.floor(hours);
		const m = Math.floor((hours - h) * 60);
		const s = Math.floor(((hours - h) * 60 - m) * 60);

		if (h > 0) {
			return `${h}h ${m}m ${s}s`;
		} else if (m > 0) {
			return `${m}m ${s}s`;
		} else {
			return `${s}s`;
		}
	}

	private startUpdateInterval(): void {
		// Always stop existing interval first
		this.stopUpdateInterval();
		
		// Start new interval only if timer is running
		if (this.state.isRunning) {
			this.intervalId = setInterval(() => {
				if (this.state.isRunning && this.state.startTime) {
					this.notifyStateUpdate();
				} else {
					// If timer stopped, clear interval
					this.stopUpdateInterval();
				}
			}, 1000); // Update every second
		}
	}

	private stopUpdateInterval(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	async saveState(): Promise<void> {
		if (!this.context) {
			return;
		}

		await this.context.workspaceState.update('timer_entryId', this.state.entryId);
		await this.context.workspaceState.update('timer_startTime', this.state.startTime?.getTime());
		await this.context.workspaceState.update('timer_projectId', this.state.entry?.project_id);
		await this.context.workspaceState.update('timer_taskId', this.state.entry?.task_id);
		await this.context.workspaceState.update('timer_description', this.state.entry?.name);
	}

	async loadState(): Promise<boolean> {
		if (!this.context) {
			return false;
		}

		const entryId = this.context.workspaceState.get<number>('timer_entryId');
		const startTimeMs = this.context.workspaceState.get<number>('timer_startTime');
		const projectId = this.context.workspaceState.get<number>('timer_projectId');
		const taskId = this.context.workspaceState.get<number>('timer_taskId');
		const description = this.context.workspaceState.get<string>('timer_description');

		if (entryId && startTimeMs) {
			// Check if timer still exists in Odoo
			try {
				const runningTimer = await this.timesheet.getRunningTimer();
				if (runningTimer && runningTimer.id === entryId) {
					// Timer is still running in Odoo, restore state
					const startTime = new Date(startTimeMs);
					this.state = {
						isRunning: true,
						startTime: startTime,
						entryId: entryId,
						entry: {
							id: entryId,
							name: description || '',
							date: new Date().toISOString().split('T')[0],
							unit_amount: 0,
							project_id: projectId,
							task_id: taskId,
						},
					};
					this.startUpdateInterval();
					this.notifyStateUpdate();
					return true;
				}
			} catch (error) {
				// Timer might not exist anymore, clear state
				this.clearState();
			}
		}

		return false;
	}

	async clearState(): Promise<void> {
		if (!this.context) {
			return;
		}

		await this.context.workspaceState.update('timer_entryId', undefined);
		await this.context.workspaceState.update('timer_startTime', undefined);
		await this.context.workspaceState.update('timer_projectId', undefined);
		await this.context.workspaceState.update('timer_taskId', undefined);
		await this.context.workspaceState.update('timer_description', undefined);
	}

	getClient(): OdooClient {
		return this.client;
	}

	dispose(): void {
		this.stopUpdateInterval();
		this.updateCallbacks = [];
	}
}

// Expose client for popup service
export function getClient(timerService: TimerService): OdooClient {
	return timerService.getClient();
}

