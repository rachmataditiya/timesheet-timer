import * as vscode from 'vscode';
import { TimerService, TimerState } from '../services/timerService';

export class StatusBar {
	private statusBarItem: vscode.StatusBarItem;
	private timerService: TimerService;

	constructor(timerService: TimerService) {
		this.timerService = timerService;
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100
		);
		this.statusBarItem.command = 'odoo.showTimerPopup';
		this.statusBarItem.tooltip = 'Click to control Odoo Timer';

		// Subscribe to timer state updates
		this.timerService.onStateUpdate((state) => {
			this.update(state);
		});

		// Initial update
		this.update(this.timerService.getState());
	}

	private update(state: TimerState): void {
		if (state.isRunning) {
			const elapsed = this.timerService.getElapsedTimeFormatted();
			this.statusBarItem.text = `$(clock) Timer: ${elapsed}`;
			this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			this.statusBarItem.show();
		} else {
			this.statusBarItem.text = `$(clock) Timer: Stopped`;
			this.statusBarItem.backgroundColor = undefined;
			this.statusBarItem.show();
		}
	}

	dispose(): void {
		this.statusBarItem.dispose();
	}
}

