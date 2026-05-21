/** Pancake merchant codes (display_id), e.g. 8917 / T2052 and 8917XANHCOM / T2052DO. */

export type PancakeProductCodes = {
  productCode: string;
  variantCode: string;
};

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function codesFromVariationInfo(
  variationInfo: Record<string, unknown>
): PancakeProductCodes {
  const product = nestedRecord(variationInfo.product);
  const variantCode = trimString(
    variationInfo.display_id ??
      variationInfo.sku ??
      variationInfo.variation_sku ??
      variationInfo.barcode
  );
  const productCode = trimString(
    variationInfo.product_display_id ??
      product?.display_id ??
      product?.product_sku ??
      product?.sku
  );
  return { productCode, variantCode };
}

/**
 * Pancake POS uses `display_id` on variations and `product.display_id` on catalog rows.
 * Order line items usually embed `variation_info.display_id` + `product_display_id`.
 */
export function extractPancakeProductCodes(
  obj: Record<string, unknown>
): PancakeProductCodes {
  const variationInfo = nestedRecord(obj.variation_info);
  if (variationInfo) {
    const fromInfo = codesFromVariationInfo(variationInfo);
    if (fromInfo.productCode || fromInfo.variantCode) {
      return fromInfo;
    }
  }

  const product = nestedRecord(obj.product);
  const variantCode = trimString(
    obj.display_id ??
      obj.sku ??
      obj.variation_sku ??
      obj.variation_code ??
      obj.barcode
  );
  const productCode = trimString(
    obj.product_display_id ??
      product?.display_id ??
      obj.product_sku ??
      obj.product_code ??
      obj.parent_sku ??
      obj.spu
  );

  if (!productCode && variantCode) {
    return { productCode: '', variantCode };
  }

  return { productCode, variantCode };
}

export function mergePancakeProductCodes(
  base: PancakeProductCodes,
  incoming: Partial<PancakeProductCodes>
): PancakeProductCodes {
  return {
    productCode: base.productCode || incoming.productCode || '',
    variantCode: base.variantCode || incoming.variantCode || '',
  };
}
