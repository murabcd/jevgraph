import { Hash, SquareCheck, Type } from "lucide-react";

export const startFieldTypes = [
	{ value: "string", label: "Short Text", Icon: Type },
	{ value: "number", label: "Number", Icon: Hash },
	{ value: "boolean", label: "Checkbox", Icon: SquareCheck },
] as const;
