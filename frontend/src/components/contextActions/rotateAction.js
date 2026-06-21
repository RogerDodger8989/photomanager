import { api } from '../../api.js';
import { toastWithUndo, toast } from '../../utils.js';

/**
 * Roterar ett eller flera assets med given vinkel (90 eller -90).
 * Uppdaterar miniatyrer och erbjuder undo.
 *
 * @param {object[]} assets
 * @param {number} angle  90 = medsols, -90 = motsols
 * @param {function} [onRefresh]
 */
export async function rotateAssets(assets, angle, onRefresh) {
  if (!assets.length) return;

  const label = angle > 0 ? 'medsols' : 'motsols';
  const count = assets.length;

  try {
    await Promise.all(
      assets.map((a) =>
        api.editAsset(a.id, { operations: [{ type: 'rotate', angle }], saveAs: 'replace' })
          .then((res) => {
            // Uppdatera miniatyr om servern returnerar nytt thumb
            const newThumb = res?.data?.thumb_small_path;
            if (newThumb) {
              const img = document.querySelector(`.photo-cell[data-id="${a.id}"] img`);
              if (img) /** @type {HTMLImageElement} */ (img).src = `/thumbs/${newThumb}?t=${Date.now()}`;
              a.thumb_small_path = newThumb;
            } else {
              // Tvinga cache-bust ändå
              const img = document.querySelector(`.photo-cell[data-id="${a.id}"] img`);
              if (img) {
                const src = /** @type {HTMLImageElement} */ (img).src.split('?')[0];
                /** @type {HTMLImageElement} */ (img).src = `${src}?t=${Date.now()}`;
              }
            }
          })
          .catch(() => null),
      ),
    );

    const undoAngle = -angle;
    toastWithUndo(
      `${count} bild${count > 1 ? 'er' : ''} roterad${count > 1 ? 'e' : ''} ${label}`,
      async () => {
        await rotateAssets(assets, undoAngle, onRefresh);
      },
      onRefresh,
    );
  } catch (err) {
    toast('Rotering misslyckades: ' + (err.message ?? 'Okänt fel'), 'error');
  }
}
