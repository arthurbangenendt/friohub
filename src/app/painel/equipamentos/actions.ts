"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
export type EquipmentState={ok:boolean;message:string};
export async function adicionarEquipamento(_:EquipmentState,formData:FormData):Promise<EquipmentState>{
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)return{ok:false,message:"Sua sessão expirou."};
 const label=String(formData.get("label")??"").trim(),address=String(formData.get("address")??"").trim();
 if(label.length<2||address.length<5)return{ok:false,message:"Informe o local e o endereço."};
 const {data:site,error:siteError}=await supabase.from("customer_sites").insert({customer_id:user.id,label,address,cep:String(formData.get("cep")??"")||null}).select("id").single();
 if(siteError)return{ok:false,message:siteError.message};
 const capacity=Number(formData.get("capacity")??0);
 const {error}=await supabase.from("customer_equipment").insert({customer_id:user.id,site_id:site.id,brand:String(formData.get("brand")??"")||null,model:String(formData.get("model")??"")||null,capacity_btu:capacity||null,installed_at:String(formData.get("installedAt")??"")||null});
 if(error)return{ok:false,message:error.message}; revalidatePath("/painel/equipamentos"); return{ok:true,message:"Equipamento adicionado ao seu histórico."};
}
