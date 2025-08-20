import type { Response } from 'express';

type ProgressPayload = {
	status: 'processing' | 'completed' | 'failed';
	processed: number;
	total: number;
	percent: number;
};

// Map bidPackageId -> set of SSE clients
const bidPackageClients: Map<number, Set<Response>> = new Map();

export function registerProgressClient(bidPackageId: number, res: Response) {
	let set = bidPackageClients.get(bidPackageId);
	if (!set) {
		set = new Set<Response>();
		bidPackageClients.set(bidPackageId, set);
	}
	set.add(res);
}

export function removeProgressClient(bidPackageId: number, res: Response) {
	const set = bidPackageClients.get(bidPackageId);
	if (set) {
		set.delete(res);
		if (set.size === 0) bidPackageClients.delete(bidPackageId);
	}
}

export function emitProgress(bidPackageId: number, payload: ProgressPayload) {
	const set = bidPackageClients.get(bidPackageId);
	if (!set || set.size === 0) return;
	const data = `data: ${JSON.stringify(payload)}\n\n`;
	for (const res of set) {
		try {
			res.write(data);
		} catch {}
	}
}


