import java.io.File;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.zip.ZipFile;

public class SelectClass {
    public static void main(String[] args) throws Exception {
        for (String path : args) {
            for (String profile : new String[] {"11", "17", "21"}) {
                try (JarFile jar = new JarFile(new File(path), false, ZipFile.OPEN_READ,
                                               Runtime.Version.parse(profile))) {
                    JarEntry entry = jar.getJarEntry("Probe.class");
                    try (InputStream bytes = jar.getInputStream(entry)) {
                        byte[] sha = MessageDigest.getInstance("SHA-256").digest(bytes.readAllBytes());
                        System.out.println(String.join("\t", path, profile, entry.getRealName(),
                                                       HexFormat.of().formatHex(sha)));
                    }
                }
            }
        }
    }
}
