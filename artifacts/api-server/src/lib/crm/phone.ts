import type { NumberType } from "libphonenumber-js/max";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export interface NormalizedPhone {
  phoneRaw: string;
  phoneCountry: string;
  phoneCountryCallingCode: string;
  phoneNationalNumber: string;
  phoneE164: string | null;
  phoneValidationStatus: "valid" | "invalid" | "possible" | "empty";
  phoneType: string | null;
}

function mapType(type: NumberType | undefined): string | null {
  if (!type) return null;
  return String(type).toLowerCase();
}

function foldIndicDigits(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

export function normalizePhone(
  raw: string | undefined | null,
  country: string,
): NormalizedPhone {
  const phoneRaw = foldIndicDigits((raw ?? "").trim());
  if (!phoneRaw) {
    return {
      phoneRaw: "",
      phoneCountry: country,
      phoneCountryCallingCode: "",
      phoneNationalNumber: "",
      phoneE164: null,
      phoneValidationStatus: "empty",
      phoneType: null,
    };
  }
  const parsed = parsePhoneNumberFromString(phoneRaw, country as never);
  if (!parsed) {
    return {
      phoneRaw,
      phoneCountry: country,
      phoneCountryCallingCode: "",
      phoneNationalNumber: phoneRaw.replace(/\D/g, ""),
      phoneE164: null,
      phoneValidationStatus: "invalid",
      phoneType: null,
    };
  }
  const valid = parsed.isValid();
  const possible = parsed.isPossible();
  const type = parsed.getType();
  if (parsed.ext) {
    return {
      phoneRaw,
      phoneCountry: parsed.country ?? country,
      phoneCountryCallingCode: String(parsed.countryCallingCode),
      phoneNationalNumber: parsed.nationalNumber,
      phoneE164: null,
      phoneValidationStatus: "invalid",
      phoneType: mapType(type),
    };
  }
  return {
    phoneRaw,
    phoneCountry: parsed.country ?? country,
    phoneCountryCallingCode: String(parsed.countryCallingCode),
    phoneNationalNumber: parsed.nationalNumber,
    phoneE164: valid || possible ? parsed.number : null,
    phoneValidationStatus: valid ? "valid" : possible ? "possible" : "invalid",
    phoneType: mapType(type),
  };
}

export function isAcceptablePhone(phone: NormalizedPhone): boolean {
  return phone.phoneValidationStatus === "valid";
}
