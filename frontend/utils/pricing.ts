import { PricingConfig } from '../types';

export interface PriceResult {
  total: number;
  breakdown: {
    roomUse: string; // Deprecated but kept for compatibility if needed, or we just remove it from UI
    pricePerGuest: number;
    adultTotal: number;
    childTotal: number;
    subtotal: number;
    discountRate: number;
    discountedSubtotal: number;
    cleaningFee: number;
  };
  isValid: boolean;
  message?: string;
}

export const calculateHomestayPrice = (
  adults: number, 
  children: number, 
  infants: number,
  nights: number,
  config: PricingConfig
): PriceResult => {
  // Infants (<3) are free and do not count towards the paying guest tier
  const payingGuests = adults + children; 

  // Find the max guests supported by checking the highest guest entry in rates
  const maxConfiguredGuests = Math.max(...config.rates.map(r => r.guests), 0);
  
  // Note: We validate against paying guests for pricing tiers. 
  // Infants are generally allowed on top, or checked against physical capacity elsewhere.
  if (payingGuests < 1) {
      return {
          total: 0,
          breakdown: {} as any,
          isValid: false,
          message: "At least 1 adult is required."
      };
  }
  
  if (payingGuests > maxConfiguredGuests) {
    return {
      total: 0,
      breakdown: {} as any,
      isValid: false,
      message: `Maximum paying guests allowed is ${maxConfiguredGuests}.`
    };
  }

  // 1. Determine Price Per Guest based on PAYING guests
  // Find exact match, or fallback to the closest defined rate
  const rateTier = config.rates.find(r => r.guests === payingGuests);
  const pricePerGuest = rateTier ? rateTier.price : (config.rates[config.rates.length - 1]?.price || 0);

  // 2. Determine Cleaning Fee based on PAYING guests
  const cleaningTier = config.cleaning.find(
      c => payingGuests >= c.minGuests && payingGuests <= c.maxGuests
  );
  const cleaningFee = cleaningTier ? cleaningTier.price : 0;

  // 3. Calculate Guest Costs
  const adultTotal = adults * pricePerGuest * nights;
  
  // Children (3-6) discount logic
  const discountMultiplier = 1 - (config.childDiscountPercent / 100);
  const childUnitPrice = pricePerGuest * discountMultiplier;
  const childTotal = children * Math.round(childUnitPrice) * nights;

  // Infants are free (0 cost)

  const subtotal = adultTotal + childTotal;

  // 4. Long Stay Discount
  let discountRate = 1.0;
  if (nights >= config.longStayMinNights) {
    discountRate = 1 - (config.longStayDiscountPercent / 100);
  }

  const discountedSubtotal = subtotal * discountRate;
  
  // 5. Final Total
  const total = Math.round(discountedSubtotal + cleaningFee);

  return {
    total,
    breakdown: {
      roomUse: "", 
      pricePerGuest,
      adultTotal,
      childTotal,
      subtotal,
      discountRate,
      discountedSubtotal,
      cleaningFee
    },
    isValid: true
  };
};