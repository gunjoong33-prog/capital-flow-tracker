"use server";

import { saveManualInputs } from "@/lib/manual-inputs";
import { revalidatePath } from "next/cache";

export async function submitManualInputs(formData: FormData) {
  const today = new Date().toISOString().slice(0, 10);
  const fearGreedRaw = formData.get("fearGreed");

  await saveManualInputs(today, {
    fearGreed: fearGreedRaw && fearGreedRaw !== "" ? Number(fearGreedRaw) : null,
    domesticWeightHigh: formData.get("domesticWeightHigh") === "on",
  });

  revalidatePath("/");
  revalidatePath("/manual-input");
}
