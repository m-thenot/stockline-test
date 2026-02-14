import { db } from "../index";
import { PreOrderRepository } from "./PreOrderRepository";
import { PreOrderFlowRepository } from "./PreOrderFlowRepository";

export const preOrderRepository = new PreOrderRepository(db);
export const preOrderFlowRepository = new PreOrderFlowRepository(db);

// Re-export classes for testing
export { PreOrderRepository, PreOrderFlowRepository };

// Re-export base class
export { Repository } from "../repository";
