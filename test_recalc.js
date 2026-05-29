"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var promise_1 = __importDefault(require("mysql2/promise"));
var CoCeoDataGateway_1 = require("./src/core/dal/CoCeoDataGateway");
var LedgerImportService_1 = require("./src/core/invest/LedgerImportService");
var CustodyEngine_1 = require("./src/core/invest/CustodyEngine");
var threePricesEngine_1 = require("./src/core/invest/threePricesEngine");
function test() {
    return __awaiter(this, void 0, void 0, function () {
        var connection, rows, orgId, gateway, ctx, ledgerService, events, assets, pricesMap, _i, assets_1, asset, ticker, tp;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, promise_1.default.createConnection({
                        host: 'localhost',
                        user: 'root',
                        password: 'Dani160779!',
                        database: 'co_ceo_db',
                    })];
                case 1:
                    connection = _a.sent();
                    return [4 /*yield*/, connection.query('SELECT organization_id FROM users LIMIT 1')];
                case 2:
                    rows = (_a.sent())[0];
                    orgId = rows[0].organization_id;
                    return [4 /*yield*/, connection.end()];
                case 3:
                    _a.sent();
                    gateway = new CoCeoDataGateway_1.CoCeoDataGateway();
                    ctx = {
                        userId: 'system',
                        organizationId: orgId,
                        impersonatorId: null,
                        scope: 'global',
                    };
                    ledgerService = new LedgerImportService_1.LedgerImportService(gateway);
                    return [4 /*yield*/, ledgerService.listLedgerEvents(ctx, '2000-01-01', '2026-12-31')];
                case 4:
                    events = _a.sent();
                    console.log("Found ".concat(events.length, " events"));
                    assets = (0, CustodyEngine_1.rebuildCustodyFromLedger)(events).assets;
                    pricesMap = (0, threePricesEngine_1.computeThreePricesByUnderlying)(events);
                    for (_i = 0, assets_1 = assets; _i < assets_1.length; _i++) {
                        asset = assets_1[_i];
                        if (asset.assetType !== 'stock' && asset.assetType !== 'fii')
                            continue;
                        ticker = String(asset.ticker).trim().toUpperCase();
                        tp = pricesMap.get(ticker);
                        console.log("Asset: ".concat(ticker));
                        console.log("  - avgPrice (custody): ".concat(asset.avgPrice));
                        console.log("  - tp (threePrices):", tp);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
test().then(function () { return process.exit(0); }).catch(console.error);
