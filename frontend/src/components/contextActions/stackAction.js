import { api } from '../../api.js';
import { toast } from '../../utils.js';

/**
 * Skapar en ny stack av givna assets.
 * Det första assetet blir omslagsbild.
 */
export async function createStack(assets, onRefresh) {
  if (assets.length < 2) {
    toast('Välj minst 2 bilder för att skapa en stack', 'warn');
    return;
  }
  try {
    await api.post('/api/stacks', {
      assetIds: assets.map((a) => a.id),
      coverId: assets[0].id,
    });
    toast(`Stack skapad med ${assets.length} bilder`, 'success');
    onRefresh?.();
  } catch (err) {
    toast('Kunde inte skapa stack: ' + (err.message ?? ''), 'error');
  }
}

/**
 * Tar bort ett enskilt asset från sin stack.
 */
export async function removeFromStack(asset, onRefresh) {
  if (!asset.stack_id) return;
  try {
    await api.delete(`/api/stacks/${asset.stack_id}/assets/${asset.id}`);
    toast('Bilden togs bort från stacken', 'success');
    onRefresh?.();
  } catch (err) {
    toast('Kunde inte ta bort från stack: ' + (err.message ?? ''), 'error');
  }
}
