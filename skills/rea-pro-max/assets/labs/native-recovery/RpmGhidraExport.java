// Export explicit functions from the currently imported program without running it.
// @category REA Pro Max

import com.google.gson.GsonBuilder;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.framework.Application;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.symbol.Symbol;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public class RpmGhidraExport extends GhidraScript {
    private static final int MAX_FUNCTIONS = 16;
    private static final int MAX_INSTRUCTIONS = 512;
    private static final int MAX_EXPORT_BYTES = 4 * 1024 * 1024;

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2 || args.length > MAX_FUNCTIONS + 1 || currentProgram == null) {
            throw new IllegalArgumentException("Supply a new output path and 1–16 exact global names or 0x entry addresses.");
        }
        String version = Application.getApplicationVersion();
        if (!version.equals("12.2")) {
            throw new IllegalArgumentException("REA's exporter is pinned to Ghidra 12.2.");
        }
        String sha = currentProgram.getExecutableSHA256();
        if (sha == null || !sha.matches("(?i)[0-9a-f]{64}")) {
            throw new IllegalArgumentException("The loaded program has no original file SHA-256.");
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        Set<Address> entries = new HashSet<>();
        boolean complete = true;
        DecompInterface decompiler = new DecompInterface();
        try {
            boolean decompilationAvailable = decompiler.openProgram(currentProgram);
            for (int index = 1; index < args.length; index++) {
                monitor.checkCancelled();
                Function function = resolve(args[index]);
                if (function == null || !entries.add(function.getEntryPoint())) {
                    complete = false;
                    continue;
                }
                rows.add(exportFunction(function, decompilationAvailable ? decompiler : null));
            }
        } finally {
            decompiler.dispose();
        }
        Map<String, Object> document = new LinkedHashMap<>();
        document.put("schema_version", 1);
        document.put("kind", "rpm-ghidra-export");
        document.put("provider", Map.of("name", "Ghidra", "version", version, "exporter", "rpm-ghidra-1"));
        document.put("binary_sha256", sha.toLowerCase(Locale.ROOT));
        document.put("language", currentProgram.getLanguageID().getIdAsString());
        document.put("functions_complete", complete);
        document.put("functions", rows);
        String encoded = new GsonBuilder().serializeNulls().disableHtmlEscaping().setPrettyPrinting().create().toJson(document);
        byte[] bytes = (encoded + "\n").getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_EXPORT_BYTES) {
            throw new IllegalArgumentException("Export exceeds 4 MiB. Select fewer functions.");
        }
        Files.write(Path.of(args[0]), bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }

    private Function resolve(String selector) {
        if (selector.matches("0x[0-9a-fA-F]{1,16}")) {
            return currentProgram.getFunctionManager().getFunctionAt(toAddr(Long.parseUnsignedLong(selector.substring(2), 16)));
        }
        Function result = null;
        int matches = 0;
        for (Symbol symbol : currentProgram.getSymbolTable().getGlobalSymbols(selector)) {
            Function function = currentProgram.getFunctionManager().getFunctionAt(symbol.getAddress());
            if (function != null) {
                result = function;
                matches++;
            }
        }
        return matches == 1 ? result : null;
    }

    private Map<String, Object> exportFunction(Function function, DecompInterface decompiler) throws Exception {
        InstructionIterator listing = currentProgram.getListing().getInstructions(function.getBody(), true);
        List<Map<String, Object>> instructions = new ArrayList<>();
        long read = 0;
        while (listing.hasNext() && instructions.size() < MAX_INSTRUCTIONS) {
            monitor.checkCancelled();
            Instruction instruction = listing.next();
            byte[] bytes = instruction.getParsedBytes();
            List<String> rawPcode = new ArrayList<>();
            for (PcodeOp operation : instruction.getPcode(false)) {
                rawPcode.add(operation.toString());
            }
            if (rawPcode.size() > 64 || rawPcode.stream().anyMatch(op -> op.length() > 512) ||
                instruction.toString().length() > 512 || bytes.length < 1 || bytes.length > 16) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("address", addressString(instruction.getAddress()));
            row.put("file_offset", fileOffset(instruction.getAddress(), bytes.length));
            row.put("bytes", HexFormat.of().formatHex(bytes));
            row.put("listing", instruction.toString());
            row.put("raw_pcode", rawPcode);
            instructions.add(row);
            read += bytes.length;
        }
        String pseudocode = null;
        if (decompiler != null) {
            DecompileResults decompiled = decompiler.decompileFunction(function, 10, monitor);
            if (decompiled.decompileCompleted() && decompiled.getDecompiledFunction() != null) {
                String extracted = decompiled.getDecompiledFunction().getC();
                if (!extracted.isEmpty() && extracted.length() <= 32768) {
                    pseudocode = extracted;
                }
            }
        }
        Map<String, Object> derived = new LinkedHashMap<>();
        derived.put("status", pseudocode == null ? "unavailable" : "present");
        derived.put("text", pseudocode);
        return Map.of(
            "name", function.getName(),
            "entry", addressString(function.getEntryPoint()),
            "instructions_complete", !listing.hasNext() && read == function.getBody().getNumAddresses(),
            "instructions", instructions,
            "pseudocode", derived
        );
    }

    private Long fileOffset(Address start, int size) {
        var memory = currentProgram.getMemory();
        var first = memory.getAddressSourceInfo(start);
        if (first == null || first.getFileName() == null || first.getFileOffset() < 0 ||
            first.getFileOffset() >= 16L * 1024 * 1024 ||
            !first.getMemoryBlockSourceInfo().contains(start.add(size - 1))) {
            return null;
        }
        for (int index = 1; index < size; index++) {
            var next = memory.getAddressSourceInfo(start.add(index));
            if (next == null || next.getFileOffset() != first.getFileOffset() + index ||
                !Objects.equals(first.getFileName(), next.getFileName())) {
                return null;
            }
        }
        return first.getFileOffset();
    }

    private static String addressString(Address value) {
        return value.getAddressSpace().getName() + ":" + Long.toUnsignedString(value.getOffset(), 16);
    }
}
