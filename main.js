// --- Configuración de Supabase ---
// Claves de Supabase. Reemplazar con las locales para depuración.
const SUPABASE_URL = 'https://pjyswuhcmxbxggwzgegs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5bteT5sOHPjxcvb7GOEbaQ_PE8dn_M9';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Autenticación y Estado ---
// ¡ADVERTENCIA! Esta es una contraseña simple para un login básico.
// No es seguro para un entorno de producción.
const ADMIN_PASSWORD = 'admin';
let isAdminLoggedIn = false;
let pendingNavigationTarget = null; // Guarda el panel al que se intentó acceder

// Variables Globales
let respuestasGlobales = []; // Almacena todas las respuestas de la encuesta
let analisisGlobal = {}; // Almacena los resultados del análisis para no recalcular
let chartUsoCelularInstancia = null;
let chartNivelEstresInstancia = null;
let chartUsoVsConcentracionInstancia = null;

// Elementos del DOM
const statusMensaje = document.getElementById("statusMensaje");
const formEncuesta = document.getElementById('formEncuesta');
const btnEnviarEncuesta = document.getElementById('btnEnviarEncuesta');
const loginModal = document.getElementById('loginModal');
const closeLoginModalBtn = document.getElementById('closeLoginModal');
const cancelLoginBtn = document.getElementById('cancelLoginButton');
const loginBtn = document.getElementById('loginButton');
const loginPasswordInput = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');

// --- Lógica Principal (Controladores de Eventos) ---

/**
 * Función principal que carga las respuestas de la encuesta, las procesa y
 * actualiza la interfaz de usuario (métricas, gráficos y reportes).
 */
async function cargarYRenderizarDatos() {
    statusMensaje.textContent = "Cargando y analizando respuestas desde Supabase...";
    try {
        respuestasGlobales = await obtenerDatosDesdeAPI();

        if (respuestasGlobales.length === 0) {
            statusMensaje.textContent = "Aún no hay respuestas. ¡Sé el primero en completar la encuesta!";
            document.getElementById("panelInsercion").classList.remove("is-hidden");
            document.getElementById("panelMetricas").classList.add("is-hidden");
            document.getElementById("panelGraficos").classList.add("is-hidden");
            document.getElementById("panelReporte").classList.add("is-hidden");
            return;
        }

        statusMensaje.textContent = `Análisis completado para ${respuestasGlobales.length} encuestas.`;
        
        // Una vez cargados los datos, los analizamos y mostramos todo
        analisisGlobal = analizarRespuestas(respuestasGlobales);

        actualizarMetricas(analisisGlobal.metricas);
        actualizarGraficos(analisisGlobal.datosParaGraficos);
        actualizarReporte(respuestasGlobales);

        // Por defecto, al cargar, mostramos el panel de inserción (la encuesta).
        // Los demás paneles se ocultan hasta que el usuario navegue a ellos.
        document.getElementById("panelInsercion").classList.remove("is-hidden");
        document.getElementById("panelMetricas").classList.add("is-hidden");
        document.getElementById("panelGraficos").classList.add("is-hidden");
        document.getElementById("panelReporte").classList.add("is-hidden");

    } catch (error) {
        statusMensaje.textContent = `Error: ${error.message}. Revisa la configuración de Supabase y tu conexión a internet.`;
        alert(`Error al cargar las respuestas: ${error.message}. Revisa la consola para más detalles.`);
    }
}

// Event listener para el formulario de la encuesta
formEncuesta.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    btnEnviarEncuesta.classList.add('is-loading');
    statusMensaje.textContent = 'Enviando respuestas...';
    const nuevaRespuesta = {
        pregunta_1: document.getElementById('pregunta1').value,
        pregunta_2: document.getElementById('pregunta2').value,
        pregunta_3: document.getElementById('pregunta3').value,
        pregunta_4: document.getElementById('pregunta4').value,
        pregunta_5: document.getElementById('pregunta5').value,
        pregunta_6: document.getElementById('pregunta6').value,
        pregunta_7: document.getElementById('pregunta7').value,
        pregunta_8: document.getElementById('pregunta8').value,
        pregunta_9: document.getElementById('pregunta9').value,
        pregunta_10: document.getElementById('pregunta10').value,
    };

    try {
        const { data, error } = await supabaseClient
            .from('encuestas')
            .insert([nuevaRespuesta])
            .select();

        if (error) {
            throw error;
        }

        statusMensaje.textContent = `¡Gracias por tu respuesta! Encuesta #${data[0].id} enviada.`;
        
        formEncuesta.reset();
        await cargarYRenderizarDatos();

    } catch (error) {
        statusMensaje.textContent = `Error al enviar la encuesta: ${error.message}`;
        alert(`Error al enviar la encuesta: ${error.message}`);
    } finally {
        btnEnviarEncuesta.classList.remove('is-loading');
    }
});

// --- Funciones de Negocio ---

/**
 * Obtiene todas las respuestas de la encuesta desde Supabase.
 */
async function obtenerDatosDesdeAPI() {
    const { data, error } = await supabaseClient
        .from('encuestas')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Falló la obtención de datos desde Supabase:", error);
        throw new Error(error.message);
    }

    return data;
}

/**
 * Procesa el array de respuestas para calcular métricas y datos para los gráficos.
 * @param {Array} respuestas - El array de objetos de respuesta de la encuesta.
 * @returns {Object} Un objeto con métricas y datos para los gráficos.
 */
function analizarRespuestas(respuestas) {
    if (respuestas.length === 0) {
        return {
            metricas: { total: 0, estresPromedio: 0 },
            datosParaGraficos: {
                distribucionUsoCelular: {},
                distribucionEstres: {},
                usoVsConcentracion: {}
            }
        };
    }

    let sumaEstres = 0;
    const stressValor = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }; // Asignar valor numérico al estrés

    const distribucionUsoCelular = { 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
    const distribucionEstres = { 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
    const usoVsConcentracion = {
        'A': { 'A': 0, 'B': 0, 'C': 0, 'D': 0 }, // P2: <2h  -> P7: A,B,C,D
        'B': { 'A': 0, 'B': 0, 'C': 0, 'D': 0 }, // P2: 2-4h -> P7: A,B,C,D
        'C': { 'A': 0, 'B': 0, 'C': 0, 'D': 0 }, // P2: 5-7h -> P7: A,B,C,D
        'D': { 'A': 0, 'B': 0, 'C': 0, 'D': 0 }  // P2: >7h  -> P7: A,B,C,D
    };

    respuestas.forEach(r => {
        const usoCelular = r.pregunta_2;
        const estres = r.pregunta_4;
        const concentracion = r.pregunta_7;

        // P2: Uso del celular
        if (distribucionUsoCelular[usoCelular] !== undefined) {
            distribucionUsoCelular[usoCelular]++;
        }

        // Pregunta 4: Nivel de estrés
        if (distribucionEstres[estres] !== undefined) {
            distribucionEstres[estres]++;
            sumaEstres += stressValor[estres] || 0;
        }

        // P2 vs P7: Uso del celular vs Influencia en concentración
        if (usoVsConcentracion[usoCelular] && usoVsConcentracion[usoCelular][concentracion] !== undefined) {
            usoVsConcentracion[usoCelular][concentracion]++;
        }
    });

    const metricas = {
        total: respuestas.length,
        estresPromedio: (sumaEstres / respuestas.length).toFixed(2)
    };

    return {
        metricas,
        datosParaGraficos: { distribucionUsoCelular, distribucionEstres, usoVsConcentracion }
    };
}

// --- Lógica de Autenticación y Modal ---
function openLoginModal() {
    loginError.classList.add('is-hidden');
    loginPasswordInput.value = '';
    loginModal.classList.add('is-active');
    loginPasswordInput.focus();
}

function closeLoginModal() {
    loginModal.classList.remove('is-active');
}

function handleLoginAttempt() {
    if (loginPasswordInput.value === ADMIN_PASSWORD) {
        isAdminLoggedIn = true;
        closeLoginModal();
        // Si había una navegación pendiente, completarla.
        if (pendingNavigationTarget) {
            showPanel(pendingNavigationTarget);
            pendingNavigationTarget = null;
        } else {
            // Por defecto, ir a Métricas tras el login.
            showPanel('panelMetricas');
        }
    } else {
        loginError.classList.remove('is-hidden');
        loginPasswordInput.focus();
    }
}

// --- Funciones de UI e Inserción en DOM ---

function actualizarMetricas(metricas) {
    document.getElementById("metTotalEncuestas").textContent = metricas.total;
    document.getElementById("metEstresPromedio").textContent = `${metricas.estresPromedio} / 4`;
}

function actualizarGraficos(datosParaGraficos) {
    const { distribucionUsoCelular, distribucionEstres, usoVsConcentracion } = datosParaGraficos;

    // 1. Gráfico de Barras: Uso del Celular (Pregunta 2)
    const ctxUsoCelular = document.getElementById("chartUsoCelular").getContext("2d");
    if (chartUsoCelularInstancia) chartUsoCelularInstancia.destroy();
    
    chartUsoCelularInstancia = new Chart(ctxUsoCelular, {
        type: 'bar',
        data: {
            labels: ['< 2h', '2-4h', '5-7h', '> 7h'],
            datasets: [{
                label: 'Número de Estudiantes',
                data: Object.values(distribucionUsoCelular),
                backgroundColor: ['#28a745', '#17a2b8', '#ffc107', '#dc3545']
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Uso Diario del Celular (P2)' } }
        }
    });

    // 2. Gráfico de Torta: Distribución de Nivel de Estrés (Pregunta 4)
    const ctxEstres = document.getElementById("chartNivelEstres").getContext("2d");
    if (chartNivelEstresInstancia) chartNivelEstresInstancia.destroy();

    chartNivelEstresInstancia = new Chart(ctxEstres, {
        type: 'pie',
        data: {
            labels: ['Casi Nunca', 'Algunas Veces', 'Frecuentemente', 'Casi Siempre'],
            datasets: [{
                label: 'Nivel de Estrés',
                data: Object.values(distribucionEstres),
                backgroundColor: ['#28a745', '#17a2b8', '#ffc107', '#dc3545']
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Frecuencia de Estrés (P4)' } }
        }
    });

    // 3. Gráfico de Barras Agrupadas: Uso del Celular vs Concentración (P2 vs P7)
    const ctxUsoVsConcentracion = document.getElementById("chartUsoVsConcentracion").getContext("2d");
    if (chartUsoVsConcentracionInstancia) chartUsoVsConcentracionInstancia.destroy();

    chartUsoVsConcentracionInstancia = new Chart(ctxUsoVsConcentracion, {
        type: 'bar',
        data: {
            labels: ['< 2h', '2-4h', '5-7h', '> 7h'], // Categorías de Uso de Celular (P2)
            datasets: [
                {
                    label: 'Nada de influencia', // P7 - A
                    data: [
                        usoVsConcentracion['A']['A'],
                        usoVsConcentracion['B']['A'],
                        usoVsConcentracion['C']['A'],
                        usoVsConcentracion['D']['A']
                    ],
                    backgroundColor: 'rgba(40, 167, 69, 0.7)', // green
                },
                {
                    label: 'Poca influencia', // P7 - B
                    data: [
                        usoVsConcentracion['A']['B'],
                        usoVsConcentracion['B']['B'],
                        usoVsConcentracion['C']['B'],
                        usoVsConcentracion['D']['B']
                    ],
                    backgroundColor: 'rgba(23, 162, 184, 0.7)', // cyan
                },
                {
                    label: 'Bastante influencia', // P7 - C
                    data: [
                        usoVsConcentracion['A']['C'],
                        usoVsConcentracion['B']['C'],
                        usoVsConcentracion['C']['C'],
                        usoVsConcentracion['D']['C']
                    ],
                    backgroundColor: 'rgba(255, 193, 7, 0.7)', // yellow
                },
                {
                    label: 'Mucha influencia', // P7 - D
                    data: [
                        usoVsConcentracion['A']['D'],
                        usoVsConcentracion['B']['D'],
                        usoVsConcentracion['C']['D'],
                        usoVsConcentracion['D']['D']
                    ],
                    backgroundColor: 'rgba(220, 53, 69, 0.7)', // red
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: '🔥 Uso del Celular vs. Influencia en la Concentración (P2 vs P7)'
                }
            },
            scales: { x: { stacked: false }, y: { stacked: false } }
        }
    });
}

function actualizarReporte(respuestas) {
    const listaEncuestas = document.getElementById("listaEncuestas");
    listaEncuestas.innerHTML = ""; // Limpia la lista anterior

    if (respuestas.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'panel-block';
        placeholder.textContent = 'No hay respuestas para mostrar.';
        listaEncuestas.appendChild(placeholder);
        return;
    }

    // Mapeo de respuestas para que el reporte sea más legible
    const mapSueno = {
        'A': '< 5 horas',
        'B': '5-6 horas',
        'C': '7-8 horas',
        'D': '> 8 horas'
    };
    const mapEstres = {
        'A': 'Casi nunca',
        'B': 'Algunas veces',
        'C': 'Frecuentemente',
        'D': 'Casi siempre'
    };
    const mapRendimiento = {
        'A': 'Bajo',
        'B': 'Regular',
        'C': 'Bueno',
        'D': 'Excelente'
    };

    respuestas.forEach(r => {
        const panelBlock = document.createElement("a");
        panelBlock.className = "panel-block is-flex-direction-column is-align-items-flex-start";
        
        const fecha = new Date(r.created_at).toLocaleString();

        // Traducimos las respuestas de letras a texto legible
        const textoSueno = mapSueno[r.pregunta_1] || r.pregunta_1;
        const textoEstres = mapEstres[r.pregunta_4] || r.pregunta_4;
        const textoRendimiento = mapRendimiento[r.pregunta_9] || r.pregunta_9;

        panelBlock.innerHTML = `
            <div class="is-flex is-justify-content-space-between is-align-items-center is-fullwidth">
                <span class="icon-text">
                    <span class="panel-icon"><i class="fas fa-poll-h"></i></span>
                    <span><strong>Encuesta #${r.id}</strong></span>
                </span>
                <span class="tag is-info">${fecha}</span>
            </div>
            <div class="content is-small pl-5 mt-1">
                <strong>Horas de sueño:</strong> ${textoSueno} | 
                <strong>Nivel de estrés:</strong> ${textoEstres} | 
                <strong>Rendimiento percibido:</strong> ${textoRendimiento}
            </div>
        `;
        listaEncuestas.appendChild(panelBlock);
    });
}

const navLinks = document.querySelectorAll('.navbar-brand .navbar-item, .navbar-menu .navbar-item');
const contentPanels = [
    document.getElementById('panelInsercion'),
    document.getElementById('panelMetricas'),
    document.getElementById('panelGraficos'),
    document.getElementById('panelReporte')
];

// Muestra un panel de contenido y oculta los demás.
function showPanel(targetId) {
    contentPanels.forEach(panel => {
        if (panel) {
            panel.classList.toggle('is-hidden', panel.id !== targetId);
        }
    });
}

navLinks.forEach(link => {
    link.addEventListener('click', (event) => {
        // Previene el comportamiento de ancla por defecto.
        if (link.getAttribute('href').startsWith('#panel')) {
            event.preventDefault();
        }

        const targetId = link.getAttribute('href').substring(1);
        const requiresAuth = link.dataset.requiresAuth === 'true';

        if (requiresAuth && !isAdminLoggedIn) {
            pendingNavigationTarget = targetId; // Guarda a dónde quería ir el usuario
            openLoginModal();
        } else {
            showPanel(targetId);
        }
    });
});

// La lógica de filtros y navegación cruzada se ha eliminado porque
// estaba atada a los estados de los servidores (OK, CRITICO, etc.)
// y no tiene un equivalente directo en el modelo de encuesta.

// --- Lógica de Modo Oscuro ---
const darkModeToggle = document.getElementById('darkModeToggle');
const htmlElement = document.documentElement;
const moonIcon = '<i class="fas fa-moon"></i>';
const sunIcon = '<i class="fas fa-sun"></i>';

function setDarkMode(isDark) {
    const toggleIcon = darkModeToggle.querySelector('.icon');
    if (isDark) {
        htmlElement.classList.add('dark-mode');
        if (toggleIcon) toggleIcon.innerHTML = sunIcon;
        Chart.defaults.color = '#f5f5f5'; // Color de texto para los gráficos
    } else {
        htmlElement.classList.remove('dark-mode');
        if (toggleIcon) toggleIcon.innerHTML = moonIcon;
        Chart.defaults.color = '#666'; // Color por defecto de Chart.js para texto
    }
    // Forzar la actualización de los gráficos para que tomen los nuevos colores.
    if (chartUsoCelularInstancia) chartUsoCelularInstancia.update();
    if (chartNivelEstresInstancia) chartNivelEstresInstancia.update();
    if (chartUsoVsConcentracionInstancia) chartUsoVsConcentracionInstancia.update();
}

// --- INICIALIZACIÓN ---
// Carga los datos tan pronto como la página esté lista para que no se vea vacía.
document.addEventListener('DOMContentLoaded', () => {
    darkModeToggle.addEventListener('click', () => {
        const isDarkMode = htmlElement.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', isDarkMode);
        setDarkMode(isDarkMode);
    });

    // Aplicar modo oscuro si estaba guardado en localStorage.
    const savedMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedMode);

    // Listeners para el modal de login
    loginBtn.addEventListener('click', handleLoginAttempt);
    closeLoginModalBtn.addEventListener('click', closeLoginModal);
    cancelLoginBtn.addEventListener('click', closeLoginModal);
    loginPasswordInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            handleLoginAttempt();
        }
    });

    cargarYRenderizarDatos();
});
