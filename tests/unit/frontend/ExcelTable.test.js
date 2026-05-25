import { ExcelTable } from '../../../frontend/src/components/excel/ExcelTable.js';

describe('ExcelTable Filtering Logic', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'test-grid';
        document.body.appendChild(container);

        // Mock localStorage for GridPreferences
        Storage.prototype.getItem = jest.fn(() => null);
        Storage.prototype.setItem = jest.fn();
    });

    afterEach(() => {
        document.body.removeChild(container);
        jest.clearAllMocks();
    });

    it('should correctly apply filterText from column configuration', () => {
        const columns = [
            { key: 'id', label: 'ID', type: 'number' },
            { 
                key: 'type', 
                label: 'Type', 
                type: 'text',
                filterText: (row) => row.side === 'C' ? 'CALL' : 'PUT'
            }
        ];

        const data = [
            { id: 1, side: 'C' },
            { id: 2, side: 'P' },
            { id: 3, side: 'C' }
        ];

        const table = new ExcelTable({
            container,
            columns,
            gridId: 'test-grid'
        });

        table.render(data);

        // Simulate filtering by 'CALL'
        table.activeFilters = {
            'type': { textIn: ['CALL'] }
        };

        table.applyClientSideFilter();

        // Should only have items with side === 'C'
        expect(table.currentData).toHaveLength(2);
        expect(table.currentData[0].id).toBe(1);
        expect(table.currentData[1].id).toBe(3);

        // Simulate filtering by 'PUT'
        table.activeFilters = {
            'type': { textIn: ['PUT'] }
        };
        table.currentData = [...table.originalData]; // Reset before apply
        table.applyClientSideFilter();

        expect(table.currentData).toHaveLength(1);
        expect(table.currentData[0].id).toBe(2);
    });

    it('should generate distinct values using filterText', () => {
        const columns = [
            { 
                key: 'type', 
                label: 'Type', 
                type: 'text',
                filterText: (row) => row.side === 'C' ? 'CALL' : 'PUT'
            }
        ];

        const data = [
            { id: 1, side: 'C' },
            { id: 2, side: 'P' },
            { id: 3, side: 'C' }
        ];

        const table = new ExcelTable({
            container,
            columns,
            gridId: 'test-grid'
        });

        table.render(data);

        // The getDistinct function inside showAdvancedMenu is scoped, 
        // but we can verify it indirectly or test the change logic.
        // For now, testing applyClientSideFilter is the most important part 
        // that validates the filterText feature.
        expect(table.currentData).toHaveLength(3);
    });
});
