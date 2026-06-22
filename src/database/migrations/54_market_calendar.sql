-- Calendario de mercado (feriados por bolsa). Fonte canonica para fechamento e audit.
-- Algoritmo de seed: settlementCalendar.b3HolidaySet (Carnaval/Pascoa/Corpus + fixos nacionais).

CREATE TABLE IF NOT EXISTS market_holidays (
    holiday_date DATE NOT NULL,
    exchange_code VARCHAR(40) NOT NULL,
    name VARCHAR(180) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (holiday_date, exchange_code),
    INDEX idx_market_holidays_exchange (exchange_code, holiday_date)
);

INSERT IGNORE INTO market_holidays (holiday_date, exchange_code, name) VALUES
    ('2025-01-01', 'B3_BR', 'Confraternizacao Universal'),
    ('2025-03-03', 'B3_BR', 'Carnaval'),
    ('2025-03-04', 'B3_BR', 'Carnaval'),
    ('2025-04-18', 'B3_BR', 'Paixao de Cristo'),
    ('2025-04-21', 'B3_BR', 'Tiradentes'),
    ('2025-05-01', 'B3_BR', 'Dia do Trabalho'),
    ('2025-06-19', 'B3_BR', 'Corpus Christi'),
    ('2025-09-07', 'B3_BR', 'Independencia'),
    ('2025-10-12', 'B3_BR', 'Nossa Senhora Aparecida'),
    ('2025-11-02', 'B3_BR', 'Finados'),
    ('2025-11-15', 'B3_BR', 'Proclamacao da Republica'),
    ('2025-12-25', 'B3_BR', 'Natal'),
    ('2026-01-01', 'B3_BR', 'Confraternizacao Universal'),
    ('2026-02-16', 'B3_BR', 'Carnaval'),
    ('2026-02-17', 'B3_BR', 'Carnaval'),
    ('2026-04-03', 'B3_BR', 'Paixao de Cristo'),
    ('2026-04-21', 'B3_BR', 'Tiradentes'),
    ('2026-05-01', 'B3_BR', 'Dia do Trabalho'),
    ('2026-06-04', 'B3_BR', 'Corpus Christi'),
    ('2026-09-07', 'B3_BR', 'Independencia'),
    ('2026-10-12', 'B3_BR', 'Nossa Senhora Aparecida'),
    ('2026-11-02', 'B3_BR', 'Finados'),
    ('2026-11-15', 'B3_BR', 'Proclamacao da Republica'),
    ('2026-12-25', 'B3_BR', 'Natal'),
    ('2027-01-01', 'B3_BR', 'Confraternizacao Universal'),
    ('2027-02-08', 'B3_BR', 'Carnaval'),
    ('2027-02-09', 'B3_BR', 'Carnaval'),
    ('2027-03-26', 'B3_BR', 'Paixao de Cristo'),
    ('2027-04-21', 'B3_BR', 'Tiradentes'),
    ('2027-05-01', 'B3_BR', 'Dia do Trabalho'),
    ('2027-05-27', 'B3_BR', 'Corpus Christi'),
    ('2027-09-07', 'B3_BR', 'Independencia'),
    ('2027-10-12', 'B3_BR', 'Nossa Senhora Aparecida'),
    ('2027-11-02', 'B3_BR', 'Finados'),
    ('2027-11-15', 'B3_BR', 'Proclamacao da Republica'),
    ('2027-12-25', 'B3_BR', 'Natal');
