import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assetsRouter from "./assets";
import meRouter from "./me";
import invitationsRouter from "./invitations";
import shiftsRouter from "./shifts";
import servicesRouter from "./services";
import messagesRouter from "./messages";
import intercomRouter from "./intercom";
import marketingRouter from "./marketing";
import contactRouter from "./contact";
import platformContactRouter from "./platformContact";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(invitationsRouter);
router.use(shiftsRouter);
router.use(servicesRouter);
router.use(messagesRouter);
router.use(intercomRouter);
router.use(assetsRouter);
router.use(marketingRouter);
router.use(contactRouter);
router.use(platformContactRouter);

export default router;
