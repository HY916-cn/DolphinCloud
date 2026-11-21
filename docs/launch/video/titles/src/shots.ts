// Real Dolphin Cloud screens captured for the storyboard (docs/launch/storyboard/).
// `crop` is the region to show, as fractions of the screenshot: x, y, width, height.
// The default crop drops the side navigation and keeps the top of the page.
import login from "../../../storyboard/00-login.png";
import counterDeposit from "../../../storyboard/12-counter-deposit.png";
import counterWithdrawLimit from "../../../storyboard/61-counter-withdraw-limit.png";
import studentHome from "../../../storyboard/20-student-home-desktop.png";
import alerts from "../../../storyboard/41-admin-alerts.png";
import counterMe from "../../../storyboard/68-counter-me.png";
import importStudents from "../../../storyboard/84-admin-students-import.png";
import importStaff from "../../../storyboard/85-admin-staff-import.png";
import txnsNew from "../../../storyboard/86-admin-txns-new.png";
import products from "../../../storyboard/87-admin-products.png";
import stock from "../../../storyboard/88-admin-stock.png";
import credit from "../../../storyboard/90-admin-credit.png";
import rates from "../../../storyboard/91-admin-rates.png";
import wealth from "../../../storyboard/92-admin-wealth.png";
import settings from "../../../storyboard/95-admin-settings.png";
import students from "../../../storyboard/96-admin-students.png";
import transfer from "../../../storyboard/97-transfer.png";

export type Crop = [number, number, number, number];
export type Shot = { src: string; w: number; h: number; crop: Crop };

const PAGE: Crop = [0.18, 0, 0.8, 0.72];
const admin = (src: string, crop = PAGE): Shot => ({ src, w: 2880, h: 1800, crop });
const counter = (src: string, crop = PAGE): Shot => ({ src, w: 2360, h: 1640, crop });

export const SHOTS = {
  login: admin(login, [0, 0, 1, 1]),
  counterDeposit: counter(counterDeposit),
  counterWithdrawLimit: counter(counterWithdrawLimit),
  studentHome: admin(studentHome, [0, 0, 1, 1]),
  alerts: admin(alerts),
  counterMe: counter(counterMe),
  importStudents: admin(importStudents),
  importStaff: admin(importStaff),
  txnsNew: admin(txnsNew),
  products: admin(products),
  stock: admin(stock),
  credit: admin(credit),
  rates: admin(rates),
  wealth: admin(wealth),
  settings: admin(settings),
  students: admin(students),
  transfer: admin(transfer, [0.08, 0, 0.84, 0.6]),
  // Close crops for the design film (P5).
  tabs: counter(counterDeposit, [0.245, 0.295, 0.72, 0.08]),
  denoms: counter(counterDeposit, [0.245, 0.45, 0.405, 0.37]),
  limitField: counter(counterWithdrawLimit, [0.245, 0.41, 0.42, 0.165]),
  limitButton: counter(counterWithdrawLimit, [0.775, 0.735, 0.19, 0.09]),
};
